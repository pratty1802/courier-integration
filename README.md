# Courier Integration Platform

Courier-agnostic logistics API (Express + TypeScript + Prisma) with pluggable adapters (`urbanebolt`, `mock`, `delhivery` mock), configurable bulk processing, optional Ops UI, API on Render, UI on Vercel.

See [DESIGN.md](DESIGN.md) and [docs/HLD.md](docs/HLD.md) for architecture.

## Features

- Unified API: create / track / cancel / bulk
- Pluggable couriers (`urbanebolt`, `mock`, `delhivery` mock)
- API key auth + rate limiting + CORS
- Bulk modes: `poll` (Render free default) or `worker` (local default, Redis + BullMQ)
- Ops UI (Vite + React) for demos

---

## Prerequisites

- Node.js **20+**
- Docker Desktop (Postgres + Redis locally)
- npm
- For deploy: GitHub account, [Render](https://render.com) account, [Vercel](https://vercel.com) account

---

## Run locally

### 1. Clone and install

```bash
git clone https://github.com/<your-org>/courier-integration.git
cd courier-integration
cp .env.example .env
npm install
cd web && npm install && cd ..
```

### 2. Start Postgres + Redis

```bash
docker compose up -d
docker compose ps
```

Wait until `courier-postgres` and `courier-redis` are healthy.

### 3. Configure `.env`

Minimum local values (already in `.env.example`):

```env
NODE_ENV=development
PORT=3000
BULK_MODE=worker
DATABASE_URL=postgresql://courier:courier@localhost:5432/courier?schema=public&connection_limit=5
REDIS_URL=redis://localhost:6379
API_KEYS=dev-key-local,oms-key-1
CORS_ORIGIN=http://localhost:5173,http://localhost:5174
```

Optional (live UrbaneBolt UAT):

```env
URBANEBOLT_BASE_URL=https://uat.urbanebolt.in
URBANEBOLT_USERNAME=info@urbanebolt.com
URBANEBOLT_PASSWORD=<your-uat-password>
URBANEBOLT_CUSTOMER_CODE=UEBCUS0008
```

If you skip UrbaneBolt credentials, use `courier_partner=mock` or `delhivery`.

To run **without Redis**, set `BULK_MODE=poll` and you can stop the Redis container.

### 4. Database schema

```bash
npx prisma generate
npx prisma migrate deploy
```

### 5. Start the API

```bash
npm run dev
```

- API: `http://localhost:3000`
- Health (no auth): `http://localhost:3000/health`

Expected health payload includes `bulk_mode` and `supported_couriers` (`mock`, `urbanebolt`, `delhivery`).

### 6. Start the Ops UI (optional)

```bash
cd web
npm run dev
```

- UI: `http://localhost:5173` (or `5174` if 5173 is taken)
- Settings → API key: `dev-key-local`

Local Vite proxies `/api` and `/health` to the API. You do not need `VITE_API_BASE_URL` locally.

### 7. Smoke test

```bash
# Health
curl -s http://localhost:3000/health | jq

# Create (mock)
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-key-local' \
  -d '{
    "order_id": "ORD-LOCAL-001",
    "courier_partner": "mock",
    "service_type": "NDD",
    "shipper": {
      "name": "Shipper Co",
      "phone": "9876543210",
      "address_line1": "Warehouse 1",
      "city": "Delhi",
      "state": "DL",
      "pincode": "110001",
      "country": "INDIA"
    },
    "consignee": {
      "name": "Buyer",
      "phone": "9123456780",
      "address_line1": "Home 12, Andheri West",
      "city": "Mumbai",
      "state": "MH",
      "pincode": "400001",
      "country": "INDIA"
    },
    "parcel": { "description": "Books", "quantity": 1, "weight_kg": 0.5, "pieces": 1 },
    "payment": { "mode": "PREPAID", "collectable_value": 0, "declared_value": 100 }
  }' | jq

# Track / cancel
curl -s http://localhost:3000/api/v1/orders/ORD-LOCAL-001/track \
  -H 'X-API-Key: dev-key-local' | jq

curl -s -X POST http://localhost:3000/api/v1/orders/ORD-LOCAL-001/cancel \
  -H 'X-API-Key: dev-key-local' | jq
```

More samples: [docs/curl-examples.md](docs/curl-examples.md)  
Postman: [postman/courier-integration.postman_collection.json](postman/courier-integration.postman_collection.json)

UrbaneBolt UAT: prefer consignee pincode `400001` or `110001`; other pins are often not serviceable. Include invoice fields, dims, and `address_type` for `urbanebolt`.

---

## Environment variables

| Variable | Local | Render (API) | Notes |
|----------|-------|--------------|--------|
| `NODE_ENV` | `development` | `production` | Set in `render.yaml` |
| `PORT` | `3000` | Render injects | Do not hardcode in prod |
| `BULK_MODE` | `worker` | `poll` | `worker` needs Redis |
| `BULK_CONCURRENCY` | `10` | `10` | Items claimed per poll / worker concurrency |
| `DATABASE_URL` | Docker Postgres | From Render DB | Required |
| `REDIS_URL` | `redis://localhost:6379` | omit | Required only if `BULK_MODE=worker` |
| `API_KEYS` | `dev-key-local,...` | **secret** | Comma-separated |
| `CORS_ORIGIN` | `http://localhost:5173,...` | Vercel URL(s) | Comma-separated |
| `RATE_LIMIT_*` | defaults | set in Blueprint | Window / max / bulk max |
| `URBANEBOLT_BASE_URL` | UAT URL | UAT URL | Optional if using mock only |
| `URBANEBOLT_USERNAME` | UAT user | **secret** | |
| `URBANEBOLT_PASSWORD` | UAT password | **secret** | |
| `URBANEBOLT_CUSTOMER_CODE` | UAT code | **secret** | |
| `URBANEBOLT_TIMEOUT_MS` | `15000` | optional | |
| `URBANEBOLT_RETRY_COUNT` | `3` | optional | |
| `URBANEBOLT_RETRY_BASE_MS` | `500` | optional | |
| `CIRCUIT_FAILURE_THRESHOLD` | `5` | optional | |
| `CIRCUIT_OPEN_MS` | `30000` | optional | |
| `LOG_LEVEL` | `info` | `info` | |
| `VITE_API_BASE_URL` | unset (proxy) | n/a | **Vercel only** — Render API origin, no trailing slash |

Never commit `.env`. Use `.env.example` as the template.

---

## API overview

All `/api/v1/*` require `X-API-Key` (or `Authorization: Bearer`). `/health` is public.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Public; `bulk_mode`, couriers, circuits |
| POST | `/api/v1/orders` | Create shipment |
| GET | `/api/v1/orders/:orderId/track` | Track + persist history |
| POST | `/api/v1/orders/:orderId/cancel` | Cancel |
| POST | `/api/v1/orders/bulk` | Up to 100 orders → `batch_id` (202) |
| GET | `/api/v1/batches/:batchId` | Poll: processes work; worker: read-only |

### Bulk modes

| Mode | `POST /bulk` | `GET /batches/:id` |
|------|--------------|--------------------|
| `poll` | Persist PENDING | Claims ≤10 items and processes |
| `worker` | Persist + enqueue Redis | Read-only status |

Switch with `BULK_MODE` only — no code changes.

---

## Deploy (GitHub → Render API + Vercel UI)

One repo. Push to `main` auto-deploys both after they are connected once.

### A. Push to GitHub

```bash
cd courier-integration
git init
git add .
git commit -m "Initial commit: courier integration API and ops UI"
git branch -M main
gh repo create courier-integration --public --source=. --remote=origin --push
```

Or create an empty repo on GitHub, then:

```bash
git remote add origin git@github.com:<your-user>/courier-integration.git
git push -u origin main
```

Confirm `.env` is **not** in the commit (`git ls-files | grep .env` should only show `.env.example`).

### B. Deploy API on Render (free)

1. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect GitHub and select this repo.
3. Render reads [`render.yaml`](render.yaml):
   - Web service `courier-integration-api` (Node, free, `BULK_MODE=poll`)
   - Postgres `courier-db` (free)
4. Fill **sync: false** secrets when prompted:

   | Key | Example |
   |-----|---------|
   | `API_KEYS` | `prod-key-1,oms-key-1` |
   | `CORS_ORIGIN` | `https://<your-app>.vercel.app` (placeholder until UI exists, e.g. `*` temporarily not recommended; use `http://localhost:5173` then update) |
   | `URBANEBOLT_USERNAME` | UAT username |
   | `URBANEBOLT_PASSWORD` | UAT password |
   | `URBANEBOLT_CUSTOMER_CODE` | e.g. `UEBCUS0008` |

   `DATABASE_URL` is injected from `courier-db`. Do not paste a local Docker URL.

5. Apply the Blueprint. Wait for **build → migrate → live**.
6. Copy the service URL, e.g. `https://courier-integration-api.onrender.com`.
7. Check health:

   ```bash
   curl -s https://<render-host>/health | jq
   ```

**Notes**

- Free web services **spin down** after ~15 minutes idle; first request can take ~1 minute.
- Free Postgres **expires after 30 days**.
- Build: `npm ci && npx prisma generate && npm run build`
- Pre-deploy: `npx prisma migrate deploy`
- Start: `node dist/server.js`
- Health check path: `/health`
- `autoDeploy: true` on branch `main` — later pushes redeploy automatically.

### C. Deploy Ops UI on Vercel

1. Open [Vercel](https://vercel.com) → **Add New** → **Project** → import the **same** GitHub repo.
2. Configure:

   | Setting | Value |
   |---------|--------|
   | Framework preset | Vite |
   | Root Directory | `web` |
   | Build command | `npm run build` (default) |
   | Output directory | `dist` (default) |
   | Production branch | `main` |

3. Environment variable (Production + Preview):

   | Name | Value |
   |------|--------|
   | `VITE_API_BASE_URL` | `https://<render-host>` (no trailing slash) |

4. Deploy. Copy the UI URL, e.g. `https://courier-ops.vercel.app`.

### D. Wire CORS (required for browser UI)

1. Render → `courier-integration-api` → **Environment**.
2. Set `CORS_ORIGIN` to the Vercel origin(s), comma-separated:

   ```text
   https://<your-ui>.vercel.app,https://<your-ui>-git-main-<team>.vercel.app
   ```

3. **Save** (triggers API redeploy).
4. In the Ops UI **Settings**, set the same production API key you put in Render `API_KEYS`.

### E. Post-deploy smoke test

```bash
API=https://<render-host>
KEY=prod-key-1

curl -s "$API/health" | jq

curl -s -X POST "$API/api/v1/orders" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $KEY" \
  -d '{
    "order_id": "ORD-PROD-001",
    "courier_partner": "mock",
    "service_type": "NDD",
    "shipper": {
      "name": "Shipper Co", "phone": "9876543210",
      "address_line1": "Warehouse 1", "city": "Delhi",
      "state": "DL", "pincode": "110001", "country": "INDIA"
    },
    "consignee": {
      "name": "Buyer", "phone": "9123456780",
      "address_line1": "Home 12, Andheri West", "city": "Mumbai",
      "state": "MH", "pincode": "400001", "country": "INDIA"
    },
    "parcel": { "description": "Books", "quantity": 1, "weight_kg": 0.5, "pieces": 1 },
    "payment": { "mode": "PREPAID", "collectable_value": 0, "declared_value": 100 }
  }' | jq
```

Open the Vercel UI → Create with `mock` → Track / Cancel / Bulk.

### Later updates

```bash
git add -A
git commit -m "Your message"
git push origin main
```

Render and Vercel redeploy from `main` automatically.

---

## How to add a courier

1. Implement `CourierAdapter` under `src/couriers/<name>/`
2. Register in `src/couriers/register.ts`
3. Add env vars
4. Do not change routes / unified DTOs / other adapters

---

## Scripts

```bash
npm run dev            # API watch (tsx)
npm run build          # prisma generate + compile API
npm run start          # node dist/server.js
npm run typecheck
npm run prisma:generate
npm run prisma:migrate # local migrate dev
npm run prisma:deploy  # apply migrations (CI / Render)
cd web && npm run dev
cd web && npm run build
```

---

## Test plan (smoke)

1. `GET /health` → `bulk_mode`, supported couriers
2. Create order with `courier_partner=mock` + API key
3. Track and cancel same `order_id`
4. Bulk 2 mock orders → poll/wait until `COMPLETED`
5. Duplicate `order_id` → idempotent response
6. Unknown partner → `UNKNOWN_COURIER`
7. Missing API key → `UNAUTHORIZED`
