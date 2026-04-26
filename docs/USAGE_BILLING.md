# Usage and billing (integrator contract)

The HTTP API is **synchronous** and **per-request**. For **metering, quotas, and invoices**, align your billing system to one of the definitions below. This document is the **reference contract**; your commercial terms (per seat, per month, per row) are between you and the customer.

## What the station measures (counters)

Per **logical tenant** (see `TENANT_KEYS_JSON` or the implicit `default` tenant for single-key auth), the process keeps **in-memory** counters for the current **uptime** of that process (reset on restart unless you export to Prometheus or another time series elsewhere).

| Field | Meaning |
|-------|--------|
| `postVerify` | Number of **`POST /v1/verify`** requests attributed to the tenant. |
| `postBatch` | Number of **`POST /v1/verify/batch`** requests. |
| `batchRows` | Sum of **`items.length`** for all successful batch request parsing paths (one increment per item row submitted). |

Retrieve via protected **`GET /v1/usage`** (see [API.md](API.md)). Global totals and p95 latency are on **`GET /v1/metrics`**.

**Note:** Idempotent **replays** (same `X-Idempotency-Key` returning cached 200) still run through the same handler; if you need “bill on unique work only,” use idempotency keys and your own deduplication, or read counters only for **approximate** load.

## Billable unit options (pick one policy and document in your MSA)

1. **Request-based (simplest)**  
   - Bill **1 unit** for each `POST /v1/verify` and **1 unit** for each `POST /v1/verify/batch` (ignoring row count).  
   - Use `postVerify` + `postBatch`.

2. **Row-based (fair for high-volume batch)**  
   - Bill **1 unit** for each `POST /v1/verify` and **1 unit per item** in each batch.  
   - Use `postVerify` + `batchRows` (or `postVerify + batchRows` if you do not double-count: typically **postVerify** is single address, **batchRows** is all batch lines).

3. **Hybrid**  
   - Minimum per batch request + per row overage — implement in your billing layer; export raw counters from the station and combine off-box.

**Recommended for SaaS API pricing:** state clearly whether **idempotent replays** and **4xx/5xx** are billable. Many products bill **only 200 OK**; this service returns **200** for successful JSON **including** valid negative outcomes (`code: "undeliverable"`, etc.); only transport/validation errors use non-2xx.

## Multi-instance and persistence

Per-process memory counters are **not** a durable ledger. For authoritative billing, aggregate **at your edge** (API gateway), **WAF logs**, or **export** `/v1/metrics` to Prometheus and bill from a **durable** store. For multiple app instances, use a **shared** rate limit / idempotency store (e.g. Redis) so limits are consistent; see [SCALING.md](SCALING.md).
