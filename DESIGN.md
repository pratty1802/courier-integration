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
Batch status; per-item partner, status (`PENDING` → `PROCESSING` → success/fail), reason, optional order link  

Normalized statuses: `CREATED | PICKED_UP | IN_TRANSIT | DELIVERED | CANCELLED | FAILED`

---

## 5. Bulk processing — two designs, one config switch

| | Design A — `BULK_MODE=poll` | Design B — `BULK_MODE=worker` |
|--|------------------------------|-------------------------------|
| Default | **Render** | **Local** |
| `POST /orders/bulk` | Persist PENDING → return `batch_id` | Persist + enqueue → return `batch_id` |
| `GET /batches/:id` | Claims ≤10 items and processes | Read-only status |
| Infra | Web + Postgres | Web + Redis + worker |
| Cost on Render | ~$0 | ~$17–$30/mo if fully paid |

**Why poll on free Render:** free web services spin down; dedicated background workers are not free. Poll-driven work survives that constraint and still meets “don’t process 100 sequentially in one HTTP request” via bounded concurrency per poll.

**Why worker locally:** Redis in Docker + BullMQ gives true async and a production-shaped path without paying for Render workers during development.

**Idempotency:** unique `order_id`; duplicates return existing shipment. Concurrent polls use claim (`PENDING` → `PROCESSING`) so the same item is not double-shipped.

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
| Free hosting | Poll bulk + free Postgres (30-day) | Cold starts; no always-on worker on Render free |
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
