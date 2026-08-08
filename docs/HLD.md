# High Level Design — Courier Integration Platform

## 1. Goal

Provide one courier-agnostic API for internal consumers (OMS, frontend, ops UI). Callers pass a `courier_partner` identifier and a normalized payload. The platform routes to the right courier integration, persists orders and tracking, and handles bulk create with partial success and idempotency.

Also expose a simple **operations UI** so humans can create, track, cancel, and bulk-submit orders against the same unified API (API key + rate limits apply).

Adding a new courier must not require changing the public API or existing courier integrations.

---

## 2. System context

Layered view:

```
┌─────────────────────────────────────────────────────────────┐
│  Clients:  OMS  ·  Ops UI (Vercel)  ·  curl / Postman       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + API Key (+ CORS for UI)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Edge:  Unified REST API                                    │
│         request_id → rate limit → API key → validation      │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Application:  Order Service  ·  Batch Service              │
│                Courier Registry (Strategy / Plugin)         │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────┐    ┌─────────────────────────────┐
│  Adapters                │    │  Store                      │
│  UrbaneBolt · Mock · …   │    │  Orders · Tracking · Batches│
└────────────┬─────────────┘    └─────────────────────────────┘
             ▼
┌──────────────────────────┐
│  External: Courier APIs  │
│  (auth, create, track,   │
│   cancel)                │
└──────────────────────────┘
```

**Design A (poll bulk)** — Batch Service starts in-process shipping on create (no Redis); `GET /batches/:id` is read-only.

**Design B (worker bulk)** — Job producer enqueues work; Background Worker + Queue sit between Batch Service and Adapters; `GET /batches/:id` is read-only.

Excalidraw:
- [docs/hld-design-a-free.excalidraw](hld-design-a-free.excalidraw)
- [docs/hld-design-b-paid.excalidraw](hld-design-b-paid.excalidraw)

Consumers never see partner-specific payloads. UI and API are separate deployments.

---

## 3. Core building blocks

| Block | Responsibility |
|-------|----------------|
| **Unified API** | Create, track, cancel, bulk create, batch status |
| **API key auth** | Authenticate internal consumers; reject missing/invalid keys |
| **Rate limiting** | Cap requests per identity (and stricter on bulk) to protect platform and partners |
| **Validation & middleware** | Input checks, request id, consistent error shape |
| **Order / batch services** | Business flow, persistence, idempotency |
| **Partner registry** | Resolve `courier_partner` → plugin; reject unknown partners with supported list |
| **Partner plugin** | Auth with partner, create / track / cancel, map statuses and errors |
| **Store** | Orders, tracking history, batches, audit payloads |
| **Bulk engine** | Two modes (configurable): poll-driven or background worker |
| **Ops UI** | Browser console (hosted on Vercel) for create / track / cancel / bulk against the unified API |

---

## 4. Persistent store (logical)

### Orders
- Internal order id (caller-supplied, unique)
- Courier partner
- Partner shipment / order id
- AWB / tracking number
- Current status
- Full request sent to partner + full response received (audit)
- Created / updated timestamps

### Tracking history (append-only)
- One row per status update
- Status, timestamp, raw partner payload
- Never overwrite; only append

### Batches
- Batch id, overall status
- Per-order items: partner, success/failure, reason, link to order when successful

### Status vocabulary (normalized)
`CREATED` → `PICKED_UP` → `IN_TRANSIT` → `DELIVERED`  
Also: `CANCELLED`, `FAILED`  
Partner-specific codes are mapped inside each plugin.

---

## 5. Edge security (every business request)

```
Client                    Platform
  │                          │
  │  + API key header        │
  │─────────────────────────►│
  │                          │ 1. Attach request id
  │                          │ 2. Rate limit (by key / identity)
  │                          │    over limit → 429 RATE_LIMITED
  │                          │ 3. Validate API key
  │                          │    missing/invalid → 401 UNAUTHORIZED
  │                          │ 4. Validate body/params
  │                          │ 5. Business handler…
```

| Concern | Behavior |
|---------|----------|
| **API key** | Required on all `/api/v1/*` routes; health check stays open for platform probes |
| **Rate limit** | Per API key (preferred) within a time window; bulk endpoint has a stricter cap |
| **Over limit** | Reject with `RATE_LIMITED` and retry guidance; do not call partner |
| **Bad key** | Reject with `UNAUTHORIZED`; do not leak whether the key format was almost valid |

---

## 6. End-to-end flows

### 6.1 Create order

```
Client                Platform                    Partner
  │                      │                           │
  │ POST /orders         │                           │
  │ (key + partner +     │                           │
  │  payload)            │                           │
  │─────────────────────►│                           │
  │                      │ auth + rate limit         │
  │                      │ validate                  │
  │                      │ resolve partner plugin    │
  │                      │ check idempotency         │
  │                      │ (same order_id?)          │
  │                      │── create shipment ───────►│
  │                      │◄── shipment id + AWB ─────│
  │                      │ persist order + audit     │
  │                      │ append tracking CREATED   │
  │◄──── normalized ─────│                           │
  │      order result    │                           │
```

**Steps**
1. Client sends API key + normalized order + `courier_partner`.
2. Platform applies rate limit, authenticates key, validates input.
3. Registry selects the partner plugin (or returns unknown-partner error).
4. If `order_id` already exists → return existing shipment (no second create).
5. Plugin authenticates with partner if needed, maps payload, creates shipment.
6. Platform stores order, AWB, partner ids, request/response audit, initial tracking event.
7. Client receives normalized success (or normalized error).

---

### 6.2 Track shipment

```
Client                Platform                    Partner
  │                      │                           │
  │ GET .../track        │                           │
  │─────────────────────►│ load order from store     │
  │                      │── track by AWB ──────────►│
  │                      │◄── status updates ────────│
  │                      │ map status                │
  │                      │ update order status       │
  │                      │ append tracking events    │
  │◄──── status + ───────│                           │
  │      history         │                           │
```

**Steps**
1. Load order by internal `order_id`.
2. Plugin fetches status from partner using AWB / partner reference.
3. Map partner status → normalized status.
4. Update current status; append any new events to tracking history.
5. Return current status and history (never raw partner errors to client).

---

### 6.3 Cancel order

```
Client                Platform                    Partner
  │                      │                           │
  │ POST .../cancel      │                           │
  │─────────────────────►│ load order                │
  │                      │── cancel ────────────────►│
  │                      │◄── ack / result ──────────│
  │                      │ status → CANCELLED        │
  │                      │ append tracking event     │
  │◄──── result ─────────│                           │
```

---

### 6.4 Bulk create (high level)

Shared entry:
1. Client sends up to 100 orders (each may use a different `courier_partner`).
2. Platform validates the batch.
3. Creates a batch record + pending items; returns `batch_id` immediately.
4. Client polls batch status until complete; response shows per-order success/failure.

**Mode A — Poll / in-process (default on free hosting)**  
On bulk submit, the same web process starts shipping immediately (waves of `BULK_CONCURRENCY`). Status GET is read-only.

**Mode B — Worker-driven (default locally)**  
On bulk submit, work is queued. A background worker processes items concurrently. Status GET is read-only.

Both modes:
- Partial success (e.g. 95 ok / 5 failed with reasons)
- Same idempotency rules per `order_id`
- Same store and partner plugins

```
Client                 Platform                      Partners
  │                       │                             │
  │ POST /orders/bulk     │                             │
  │──────────────────────►│ validate, save batch        │
  │                       │── create shipments ────────►│
  │◄──── batch_id ────────│◄────────────────────────────│
  │                       │                             │
  │ GET /batches/:id      │  (read-only status)         │
  │──────────────────────►│                             │
  │◄──── progress ────────│                             │
  │         …             │                             │
  │ GET /batches/:id      │                             │
  │──────────────────────►│                             │
  │◄──── COMPLETED + ─────│                             │
  │      per-order results│                             │
```

---

## 7. Idempotency

| Rule | Behavior |
|------|----------|
| Unique `order_id` | Store enforces uniqueness |
| Duplicate create | Do not create a second shipment; return existing order/AWB |
| Duplicate in bulk | Item marked as already created / success with existing reference |
| Concurrent bulk waves | Claim pending → processing before work so two waves do not double-ship |

Idempotency key for create is the caller’s `order_id`.

---

## 8. Error handling

One error shape for all endpoints:

```
{
  "error": {
    "code": "...",
    "message": "...",
    "details": [ { "field": "...", "message": "..." } ],
    "request_id": "..."
  }
}
```

| Situation | Behavior |
|-----------|----------|
| Missing / invalid API key | `UNAUTHORIZED` |
| Rate limit exceeded | `RATE_LIMITED` (with retry guidance) |
| Bad input | Validation error with field-level details |
| Unknown `courier_partner` | Error + list of supported partners |
| Partner client error (4xx) | Mapped to platform error code; **do not** leak raw partner message |
| Partner outage / timeout / 5xx | Retry with backoff (configurable), then fail gracefully; persist failure for reconciliation |
| Partner auth expired | Re-authenticate and retry once |
| Logging | Every failure: `order_id`, `courier_partner`, `request_id`, error type, stack when useful |

Layers:
1. **Edge** — request id, rate limit, API key, validate  
2. **Service** — business rules, idempotency, persistence of failures  
3. **Plugin** — partner HTTP, retries, auth refresh, status/error mapping  

---

## 9. Partner plugin model

```
                    ┌─────────────────┐
   Order service ──►│ Partner registry │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         UrbaneBolt       Mock /         Future
         plugin           demo           partners
              │
              ▼
         Partner API
         (auth, create, track, cancel)
```

Each plugin owns:
- Credential / token handling for that partner  
- Request/response mapping  
- Status and error normalization  

Public API, DTOs, and core services stay partner-agnostic.

---

## 10. Ops UI (high level)

```
┌─────────────────────────────────────────┐
│  Ops UI (Vercel)                        │
│  Settings (API key) · Create · Track    │
│  Cancel · Bulk · Batch status           │
└─────────────────┬───────────────────────┘
                  │ HTTPS + API key + CORS
                  ▼
            Unified API (separate host)
```

| Capability | Flow |
|------------|------|
| Hosting | UI on Vercel, API on Render; both auto-deploy from the same GitHub repo on push to `main` |
| Connect | User enters API key once; UI stores it and sends it on every request |
| Create / track / cancel | Forms map 1:1 to unified endpoints; show normalized success or error |
| Bulk | Submit many orders → receive `batch_id` → poll until complete → show per-order results |
| Visibility | Surface `request_id` and error codes from the platform on failures |
| Hosting | UI and API are separate; UI configured with API base URL; API allows UI origin via CORS |

The UI is a client of the platform, not a second integration path. No direct calls to courier partners from the browser.

---

## 11. Configuration posture (conceptual)

- Partner credentials, base URLs, timeouts, retry counts, API keys, rate-limit windows, and bulk mode come from configuration — not hardcoded.
- **API keys** — allowlist of keys issued to internal consumers (OMS, Ops UI, etc.).
- **Rate limits** — window size, general cap, stricter bulk cap.
- **Bulk mode** is selectable:
  - Poll-driven — suitable for constrained free API hosting  
  - Worker-driven — suitable for local / production async processing  
- **Hosting split** — Ops UI on Vercel; API + store on Render. CORS and API base URL wire them together.
- **Delivery** — one GitHub repository; push to the main branch triggers auto-deploy on both platforms (native Git integration; no custom deploy scripts required for the happy path).

Same API contract in both bulk modes.

---

## 12. End-to-end summary (happy path)

1. Consumer (OMS or Ops UI) calls unified create (or bulk) with API key.  
2. Platform rate-limits, authenticates, validates, and resolves partner.  
3. Idempotency check on `order_id`.  
4. Partner plugin creates shipment; platform stores order + audit + tracking.  
5. Consumer tracks via unified track; platform refreshes from partner and appends history.  
6. Consumer may cancel via unified cancel; status becomes `CANCELLED` with history entry.  
7. For bulk, consumer polls batch until done and reads per-order outcomes.

Failure at any partner step is normalized, logged, and persisted where needed so the system remains reconcilable without exposing partner internals to the client.
