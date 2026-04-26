# HTTP API (Verification Station)

**Base URL:** `http://<host>:<port>` (e.g. `https://verify-api.example.com`).

**Postman:** Import `postman/VerificationStation.postman_collection.json` (Postman: **File → Import**). Edit collection **Variables** — `baseUrl` and `bearerToken` (when auth is on).

**Content type:** `Content-Type: application/json` for JSON bodies.

---

## Errors

Most failures:

```json
{
  "error": "validation_error | unauthorized | not_found | internal_error | …",
  "message": "optional",
  "details": {}
}
```

Unknown routes: `{ "error": "not_found", "method": "GET" }`.

---

## Authentication

- **Bearer:** If `STATION_SECRET` or `API_KEY` is set, protected routes need `Authorization: Bearer <same as env>`. `STATION_SECRET` wins if both are set.
- **Public (no auth):** `/health`, `/v1/ready`, `/v1/metrics` only — see [src/config/public-routes.ts](../src/config/public-routes.ts).
- **HMAC (optional):** If `HMAC_SECRET` is set, non-GET/HEAD to protected routes also need `X-Timestamp`, `X-Signature` (HMAC-SHA256 hex of `` `${timestamp}.${rawBody}` ``), `X-Request-Id`. Skew: `HMAC_SKEW_MS` (default 5 min). Replays can return **409**.
- **IP allowlist:** `IP_ALLOWLIST` — use `TRUST_PROXY=true` behind a reverse proxy.

**Secure `/v1/metrics` at the edge in production** (no app auth by default).

---

## Route overview

| Method | Path | Auth when secret set | Description |
|--------|------|------------------------|-------------|
| GET | `/health` | No | Liveness |
| GET | `/v1/ready` | No | Readiness |
| GET | `/v1/metrics` | No* | Counters, uptime (404 if `METRICS_ENABLED=false`) |
| POST | `/v1/verify` | Yes | Single email |
| POST | `/v1/verify/batch` | Yes | Batch |
| GET | `/v1/cache/stats` | Yes | Cache stats |
| POST | `/v1/cache/clear` | Yes | Clear cache namespace |
| GET | `/v1/cooldown` | Yes | Provider cooldowns |
| POST | `/v1/cooldown/reset` | Yes | Reset cooldown(s) |

---

## Bodies and responses (short)

### `POST /v1/verify`

| Field | Notes |
|-------|--------|
| `email` | Required, 3–320 chars |
| `jobId` | Optional |
| `options` | Optional: `skipSmtp`, `skipCatchAll`, `forceRefresh` (booleans) |

**200** — Result includes `email`, `code`, `message`, optional `details`, `score`, `deliverability`, `durationMs`, sometimes `providerCooldownUntil` for `retry_later` paths. See main README for `code` meanings (§8).

### `POST /v1/verify/batch`

| Field | Notes |
|-------|--------|
| `items` | Array of `{ email, jobId?, options? }` (min 1, max 10,000; env `BATCH_MAX_ITEMS` may lower cap) |
| `options` | Defaults for all rows; per-item `options` can override |

**200** — `{ "results": [ ... ] }` (one per input row).

### `POST /v1/cache/clear`

Body optional; default `{ "type": "all" }`. `type` values: `all`, `result`, `dns`, `mx`, `domain`, `dead`, `disposable`, `role`, `catchall`, `provider_cooldown`, `mx_health`, `mx_persistent`. **200:** `{ "ok": true, "cleared": "..." }`.

### `POST /v1/cooldown/reset`

`{}` or omit — clear all. `{ "provider": "gmail" }` — one provider (`gmail`, `outlook`, `yahoo`, …, `other`). **200:** `{ "ok": true }`.

### `GET /v1/cache/stats` / `GET /v1/cooldown` / `GET /health` / `GET /v1/ready` / `GET /v1/metrics`

See the previous README or run requests in Postman for example JSON shapes (memory vs SQLite for cache stats; metrics 404 when disabled).

---

## Rate limiting and status codes

- **429** — Rate limit (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`)
- **401** — Bad/missing Bearer when required
- **403** — IP / HMAC / policy
- **409** — HMAC replay
- **413** — Body too large (`REQUEST_BODY_MAX_BYTES`)
- **500** — Server error; production may return `{ "error": "internal_error" }` only

---

## More

- **Result `code` values, scoring, SMTP behaviour, cooldown:** [README.md](../README.md) sections 8–11.
- **Environment variables:** [README.md](../README.md) §2 and `.env.example`.
