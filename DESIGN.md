# DESIGN.md — Courier Integration Platform

## 1. Purpose

Internal courier integration service: one **courier-agnostic REST API** for OMS and other internal consumers. Callers pass `courier_partner` plus a normalized payload. Partner-specific APIs (starting with UrbaneBolt) are isolated behind plugins so new couriers do not require changes to controllers, DTOs, or existing adapters.

Companion doc: [docs/HLD.md](docs/HLD.md) (flow-focused, stack-light).

---

## 2. Architecture pattern

**Strategy + Registry (plugin adapters)**

```
HTTP → middleware (request id, rate limit, API key, Zod)
    → Order / Batch services
    → CourierRegistry.resolve(partnerId)
    → CourierAdapter (UrbaneBolt | Mock | …)
    → Partner HTTP API
    → Prisma → PostgreSQL
```

| Decision | Why |
|----------|-----|
| Strategy/Registry | Open for extension, closed for modification; add adapter + register + env |
| Not a giant `switch (partner)` in services | Avoids touching business logic when onboarding Delhivery, etc. |
| Not full event sourcing | Current state + append-only tracking history is enough; ES adds replay/projection cost without clear benefit |
| Prisma + Postgres | Relational model (orders ↔ tracking ↔ batches), unique `order_id`, transactions for claim locking; free Postgres on Render |

### Adapter contract

```ts
interface CourierAdapter {
  readonly partnerId: string;
  createShipment(order: NormalizedOrder): Promise<CreateShipmentResult>;
  trackShipment(ref: TrackingRef): Promise<TrackingResult>;
  cancelShipment(ref: CancelRef): Promise<CancelResult>;
}
```

Each adapter owns: partner auth/token cache, DTO mapping, retries, status/error normalization. Domain services never import UrbaneBolt field names.

---

## 3. Stack

| Layer | Choice |
|-------|--------|
| API | Express + TypeScript (strict) |
| Validation | Zod (`z.infer` at handlers) |
| ORM / DB | Prisma + PostgreSQL |
| Courier HTTP | Axios + configurable retry/backoff |
| Logs | pino (structured: `request_id`, `order_id`, `courier_partner`) |
| Bulk (local) | BullMQ + Redis when `BULK_MODE=worker` |
| Hosting | API + Postgres → Render free; auto-deploy from GitHub `main` |

### TypeScript practices (summary)

- Strict `tsconfig`; no bare `any`
- Validate HTTP and env at boundaries with Zod
- Discriminated unions for bulk results and errors
- Prisma models mapped to domain DTOs at the repository edge
- Exhaustive `switch` on statuses / modes with `never` checks

---

## 4. Database schema (logical)

**orders**  
`id`, unique `order_id`, `courier_partner`, `courier_shipment_id`, `awb`, `status`, `request_payload` (JSON), `response_payload` (JSON), timestamps  

**tracking_events** (append-only)  
FK to order, `status`, `raw_payload`, `recorded_at`  

**batches** / **batch_items**  
Batch status; per-item partner, status (`PENDING` → `PROCESSING` → success/fail/duplicate), reason, optional FK to `orders`  

Normalized statuses: `CREATED | PICKED_UP | IN_TRANSIT | DELIVERED | CANCELLED | FAILED`

**When rows appear:** `POST /orders/bulk` (create) writes `batches` + `batch_items` immediately, then creates `orders` (+ `tracking_events`) as each item is shipped. `GET /batches/:id` (poll/status) only reads; it never inserts orders.

---

## 5. Bulk processing — two designs, one config switch

**Rule:** shipments (`orders` rows) are created on the **create call** (`POST /api/v1/orders/bulk`), not on poll (`GET /api/v1/batches/:id`). Status GET is always read-only. The Ops UI 1.5s poll only refreshes the table; it does not drive shipping.

| | Design A — `BULK_MODE=poll` | Design B — `BULK_MODE=worker` |
|--|------------------------------|-------------------------------|
| Default | **Render** | **Local** |
| `POST /orders/bulk` | Persist batch + **start shipping immediately** (in-process, waves of `BULK_CONCURRENCY`) → return `batch_id` | Persist batch + enqueue Redis → return `batch_id`; worker ships |
| `GET /batches/:id` | **Read-only** status | **Read-only** status |
| When `orders` are inserted | During/after create, as each item succeeds | Same, via worker after create enqueue |
| Infra | Web + Postgres | Web + Redis + worker |
| Cost on Render | ~$0 | ~$17–$30/mo if fully paid |

**Why `poll` on free Render:** no Redis / paid worker. Name is historical; work still starts at **create**, in the same Node process. `GET` never ships. If the free instance spins down mid-batch, remaining `batch_items` stay `PENDING` — status reads do not resume them.

**Why worker locally:** Redis + BullMQ survives process restarts for queued jobs and matches a paid production worker.

**Idempotency:** unique `order_id` (global, not per batch). Resubmitting the same ids → `DUPLICATE` / existing shipment. Claim (`PENDING` → `PROCESSING`) so two waves do not double-ship.

**Upgrade path:** set `BULK_MODE=worker`, provide `REDIS_URL`, run a worker process — same API, schema, and adapters.

---

## 6. Security & edge middleware

Order: `request_id` → rate limit → API key → Zod → handler  

| Concern | Behavior |
|---------|----------|
| API key | `X-API-Key` / Bearer; allowlist from `API_KEYS`; `/health` open |
| Rate limit | Per key; stricter on bulk; `429 RATE_LIMITED` |
| CORS | `CORS_ORIGIN` allowlist for browser clients |
| Partner errors | Mapped codes; raw partner messages not leaked to clients |

---

## 7. UrbaneBolt integration (first adapter)

| Operation | Partner API |
|-----------|-------------|
| Auth | `POST /api/v1/auth/getToken/` (cache; re-auth on 401 + one retry) |
| Create | `POST /api/v1/services/manifest/` |
| Track | `GET /api/v1/services/tracking-pub/?awb=` |
| Cancel | `POST /api/v1/services/cancel/` |

Credentials, base URL, timeouts, retries, and `customerCode` come from env.

Bonus: **MockCourier** adapter for local demos without UAT calls.

---

## 8. Delivery

**GitHub `main`** → Render auto-deploys the API (`render.yaml`).

---

## 9. Error model

```json
{
  "error": {
    "code": "UNAUTHORIZED | RATE_LIMITED | VALIDATION_ERROR | UNKNOWN_COURIER | COURIER_ERROR | COURIER_UNAVAILABLE | INTERNAL_ERROR",
    "message": "...",
    "details": [{ "field": "...", "message": "..." }],
    "request_id": "..."
  }
}
```

Partner 4xx → `COURIER_ERROR`. Timeouts/5xx → retry with backoff → `COURIER_UNAVAILABLE` and persist failure. Auth expiry → refresh token + one retry.

**Circuit breaker (UrbaneBolt):** after `CIRCUIT_FAILURE_THRESHOLD` consecutive `COURIER_UNAVAILABLE` failures, the circuit opens for `CIRCUIT_OPEN_MS` and short-circuits partner calls. Then half-open allows a probe; success closes the circuit. Status exposed on `GET /health` → `circuits.urbanebolt`.

---

## 10. Trade-offs & assumptions

| Trade-off | Choice | Cost |
|-----------|--------|------|
| Free hosting | In-process bulk on create + free Postgres (30-day) | Cold starts; no Redis worker; GET does not resume stuck items |
| Dual bulk modes | Config flag | Slightly more code; clearer local vs prod story |
| API keys not OAuth | Env allowlist | Fine for internal OMS; rotate via env |
| In-memory rate limit on free | Simple | Not shared across multiple instances (acceptable on free single instance) |
| No event sourcing | State + append-only tracking | Simpler ops; still auditable |

**Assumptions:** callers are trusted internal systems with issued API keys; UrbaneBolt UAT credentials are provided via env; free Render Postgres is acceptable for the deployment lifespan.

---

## 11. How to add a courier

1. Implement `CourierAdapter` (map normalized ↔ partner payloads, auth, status map).  
2. Register in the registry bootstrap.  
3. Add partner env vars.  
4. No changes to routes, unified DTOs, or other adapters.

---

## 12. Related docs

| Doc | Content |
|-----|---------|
| [docs/HLD.md](docs/HLD.md) | End-to-end flows, store, idempotency, errors (minimal tech) |
| `docs/hld-design-a-free.excalidraw` | Boxed HLD — poll / free |
| `docs/hld-design-b-paid.excalidraw` | Boxed HLD — worker / paid |
| [README.md](README.md) | Setup, env, run, test, deploy |
| [docs/curl-examples.md](docs/curl-examples.md) | Curl samples |
| [postman/courier-integration.postman_collection.json](postman/courier-integration.postman_collection.json) | Postman collection |
