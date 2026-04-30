# HTTP API (Verification Station)

**Base URL:** `http://<host>:<port>` (e.g. `https://verify-api.example.com`).

**Postman:** Import `postman/VerificationStation.postman_collection.json` (Postman: **File → Import**). Edit collection **Variables** — `baseUrl` and `bearerToken` (when auth is on).

**Content type:** `Content-Type: application/json` for JSON bodies.

---

## API versioning and deprecation

- **Current version:** all stable routes are under the **`/v1`** path prefix. The version is part of the URL (e.g. `POST /v1/verify`); the OpenAPI document describes this surface when `API_DOCS_ENABLED=true`.
- **Non-breaking changes** (no client change required) may ship under `/v1` at any time: new optional JSON fields, new query/header options, new values in `details`, new `signals`, stricter validation that only rejects previously invalid input.
- **Breaking changes** (incompatible for existing clients) require a **new** path prefix (e.g. `/v2/...`) or an explicit, documented opt-in. When a new major version is introduced, `/v1` is kept available for a **deprecation period** (length announced in this repo’s changelog and release notes); `Sunset` / migration guidance will be published before removal.
- **Errors:** top-level error objects keep a stable **shape** — `error` (string code), optional `message`, optional `details`. `error` string values for HTTP failures are the stable integrator contract; do not key off ad-hoc `message` text for automation.

For more context: [docs/USAGE_BILLING.md](USAGE_BILLING.md) (usage and billing unit), [README – HTTP API](../README.md#7-http-api).

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

- **Bearer (single-tenant / self-host):** If `STATION_SECRET` or `API_KEY` is set and **`TENANT_KEYS_JSON` is not used**, protected routes need `Authorization: Bearer <same as env>`. `STATION_SECRET` wins if both are set.
- **Multi-tenant (optional):** If `TENANT_KEYS_JSON` is set, only bearer tokens from that list are accepted (per-key rate limits: see `rateLimitRpm` in the JSON and [PRODUCT.md](PRODUCT.md)).
- **Public (no auth):** `/health`, `/v1/ready`, `/v1/metrics`, **`/manual-verify`** (HTML tool) — see [src/config/public-routes.ts](../src/config/public-routes.ts).
- **HMAC (optional):** If `HMAC_SECRET` is set, non-GET/HEAD to protected routes also need `X-Timestamp`, `X-Signature` (HMAC-SHA256 hex of `` `${timestamp}.${rawBody}` ``), `X-Request-Id`. Skew: `HMAC_SKEW_MS` (default 5 min). Replays can return **409**.
- **IP allowlist:** `IP_ALLOWLIST` — use `TRUST_PROXY=true` behind a reverse proxy.

**Secure `/v1/metrics` at the edge in production** (no app auth by default).

---

## Route overview

| Method | Path | Auth when secret set | Description |
|--------|------|------------------------|-------------|
| GET | `/manual-verify` | No | Interactive HTML UI to run `POST /v1/verify` and view the full JSON (works even when `PWA_ENABLED=false`) |
| GET | `/health` | No | Liveness |
| GET | `/v1/ready` | No | Readiness |
| GET | `/v1/metrics` | No* | Counters, uptime, latency percentiles, `batchRowsByTenant` (404 if `METRICS_ENABLED=false`) |
| GET | `/v1/usage` | Yes | Per-tenant usage (`postVerify`, `postBatch`, `batchRows`) when metrics enabled |
| GET | `/v1/docs` | If `API_DOCS_ENABLED` | OpenAPI (Swagger UI) when enabled |
| POST | `/v1/verify` | Yes | Single email |
| POST | `/v1/verify/batch` | Yes | Batch |
| POST | `/v1/verify/jobs` | Yes | Async single verify: **202** + `jobId` if `ASYNC_VERIFY_JOBS_ENABLED` |
| GET | `/v1/verify/jobs/:id` | Yes | Poll async job; **200** when `completed` / `failed` with `result` or `error` |
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

**200** — Result includes `email`, `code`, `message`, optional `details`, `score`, `deliverability`, `durationMs`, optional `signals` (`highRiskTld`, `possibleTypoOf`) when `VERIFICATION_SIGNALS_ENABLED=true`, sometimes `providerCooldownUntil` for `retry_later` paths. See main README for `code` meanings (§8).

**SMTP:** For **non-big** domains, optional `MX_RCPT_TRANSIENT_FALLBACK_ENABLED` + `MX_RCPT_TRANSIENT_FALLBACK_MAX_EXTRA` can probe the next MX after a **transient/greylist-style** RCPT on the first (off by default). Big freemail never uses this path. `SMTP_RETRY_BIG_PROVIDER_MULT` scales inter-retry delay for big providers (default `1`).

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

## Integrator decision guide

Map `code` to **product** behaviour (not prescriptive; align with your risk model). **SMTP `RCPT` acceptance at probe time is not a promise of future inbox delivery** — see [README – what this does not do](../README.md#2-what-this-service-does-not-do).

| `code` | Suggested product action |
|--------|-------------------------|
| `valid` | Allow flows that need a *likely live* address; do not over-claim deliverability. |
| `invalid` / `dead` | Block or fix input. |
| `undeliverable` | Do not treat as mailable. |
| `unknown` | Soft-fail: optional review, magic link, or second factor — avoid hard block on this alone. |
| `retry_later` / `greylisted` | Queue retry / backoff; avoid blocking the user on first response alone for large providers. |
| `mx_unreachable` | Infrastructure or routing issue from verifier’s host; optional retry. |
| `provider_blocked` | Service cooldown; tell user to retry later or use another verification method. |
| `disposable` / `role_account` | Enforce your policy. |
| `catch_all` | Existence is ambiguous; tighten rules or add corroboration. |
| `system_error` | Retry; use `X-Idempotency-Key` to avoid duplicate billable work. |

Full table and positioning: [README §8.1](../README.md#81-integrator-decision-guide-code--product-action), [PRODUCT.md](PRODUCT.md).

**Optional response fields (when enabled):** `explain` and `confidence` (verdict confidence, not inbox placement) — see `VERIFICATION_EXPLAIN_ENABLED` in [`.env.example`](../.env.example).

**Multi-tenant / SaaS API keys:** `TENANT_KEYS_JSON` — per-key bearer, tenant id, optional per-tenant `rateLimitRpm` (see `.env.example` and [PRODUCT.md](PRODUCT.md)).

**Idempotency:** `X-Idempotency-Key` (8–128 chars) on `POST /v1/verify` and `POST /v1/verify/batch` returns the same **200** body for the same key + body + tenant within `IDEMPOTENCY_TTL_MS`.

**OpenAPI / Swagger UI:** when `API_DOCS_ENABLED=true`, spec is served for interactive docs at `/v1/docs` (same auth and network policies as the rest of the API).

**Metrics / SLO hints:** `GET /v1/metrics` (when enabled) includes `verifyByTenant`, `batchByTenant`, `batchRowsByTenant`, `verifyDurationMs` (p50 / p95 / p99 on recent `/v1/verify` timings), and `verifySlowTotal` vs `SLOW_REQUEST_THRESHOLD_MS`. **Per-tenant billing counters:** `GET /v1/usage` (auth required) returns only the current tenant. See [USAGE_BILLING.md](USAGE_BILLING.md) and [SYNTHETIC_SLO.md](SYNTHETIC_SLO.md) for SLOs and canaries.

**Redis (`REDIS_URL`):** when set, **rate limits** and **idempotency** use Redis so multiple instances see the same keys. Provider **cooldown** and **result cache** remain process-local (or SQLite on one host) unless you add a shared design—see [SCALING.md](SCALING.md).

**Async verify** (`ASYNC_VERIFY_JOBS_ENABLED`):

- `POST /v1/verify/jobs` with body like `POST /v1/verify` plus optional `callbackUrl` (HTTPS recommended). Responds **202** with `{ "jobId", "status", "createdAt" }`. Counts as one **postVerify** toward usage for the tenant.
- `GET /v1/verify/jobs/{jobId}` — while running: `status` is `pending` or `processing`; when done: `status` is `completed` with `result` (same shape as sync verify) or `failed` with `error` string.
- **Webhook:** if `callbackUrl` is set, the service **POSTs** JSON `{ jobId, status, result?, error? }` with `X-Webhook-Signature` (HMAC-SHA256 hex of `X-Webhook-Timestamp + "." + body`, secret = `WEBHOOK_SIGNING_SECRET` or `HMAC_SECRET`) and `X-Webhook-Timestamp` (ms). If neither secret is set, the webhook is skipped (logged).

---

## More

- **Result `code` values, scoring, SMTP behaviour, cooldown:** [README.md](../README.md) sections 8–11.
- **Environment variables:** [README.md](../README.md) §2 and `.env.example`.
- **Horizontal scale and shared state:** [SCALING.md](SCALING.md).
