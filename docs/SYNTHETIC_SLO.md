# Synthetic checks and SLOs

In-process JSON at **`GET /v1/metrics`** (when `METRICS_ENABLED=true`) is enough for **single-host** p50/p95 on recent `POST /v1/verify` durations, error counters, and per-tenant usage via **`GET /v1/usage`** or `verifyByTenant` in the metrics object. It is **not** a substitute for **external** observability when you need accountability to customers (uptime SLO, regional latency).

## What to measure outside the app

- **Uptime** — synthetic HTTP **GET** `/v1/ready` (or `GET /health` for liveness) from an external **probe** (Datadog, UptimeRobot, Pingdom, Grafana Cloud) every 1–5 minutes; alert on non-200 or p95 of probe latency above your threshold.
- **API path** — same probe from **two** regions if your users are global; compare with your SLO (e.g. 99.9% monthly success of probes).
- **Error rate** — ship structured logs to your stack (Loki, ELK) or use APM; alert on 5xx ratio or on `error` field spikes in your gateway logs.
- **RCPT / verification SLOs** — optional: run your **own** scheduled job that `POST /v1/verify` against **2–3 mailboxes you control** (dedicated inboxes) and assert `code` is in the expected set (e.g. `valid` or a stable `undeliverable` for a dead alias). This detects **regression in mapping** and severe DNS/transport failures; it does **not** measure inbox placement.

## Suggested alert thresholds (starting points; tune to traffic)

- `/v1/ready` failure rate: **&gt; 1%** over 15 min (infrastructure or overload).
- `verifyDurationMs.p95` from peer metrics: **&gt; your HTTP timeout** fraction of the time (probe slow paths separately).
- **Disk** if using `CACHE_BACKEND=sqlite` / `SQLITE_PATH` — &gt; 85% full on the volume.
- **Redis** if using `REDIS_URL` — `connected_clients`, memory, replication lag; rate-limit fallbacks to memory if `skipOnError: true` (limit inconsistency, not always total outage).

## What not to do

- Do not treat “RCPT 250 = inbox” as a synthetic target; the product explicitly separates RCPT at probe time from deliverability.
- Do not scrape freemail; use your own test domains or receiving addresses under your control.

## References

- [docs/SCALING.md](SCALING.md) — multi-instance, Redis, and metrics limits.
- [docs/USAGE_BILLING.md](USAGE_BILLING.md) — billable units and counters.
