# Scaling and multi-instance

## Current architecture

- **One Node process** per deployment (PM2, Docker, or systemd) with optional **in-memory** or **SQLite** cache ([`CACHE_BACKEND`](../.env.example)).
- **Provider cooldown** and optional **SQLite** persistence: single file on one host; multiple processes **must not** share a filesystem SQLite file without proper locking and are still a poor fit for **horizontal scale**.

## When you add a second app instance

1. **Provider SMTP cooldown** ([`src/services/provider-cooldown.service.ts`](../src/services/provider-cooldown.service.ts)) is **in-process** (or SQLite on **one** host) unless you use a shared store. If two processes probe the same big MX, you can **double the effective** probe rate. Mitigations:
   - Sticky routing by **recipient domain** to one worker (complex), or
   - A **shared** cooldown store: Redis (keys + TTL) or a small SQL table with `UPDATE ...` semantics. **SQLite on a network filesystem shared by N writers is a poor default**—prefer a single app instance for SQLite, or move cooldown state to Redis in a future version.

2. **Per-IP / per-tenant rate limits** ([`@fastify/rate-limit`](../src/middleware/rate-limit.middleware.ts)) use the **in-memory** store by default. Set **`REDIS_URL`** in [`env`](../.env.example) to use the same Redis for **all** app instances; the plugin is configured with `skipOnError: true` so a Redis outage does not kill requests (limits may be inconsistent for that period).

3. **Idempotency** ([`idempotency.service.ts`](../src/services/idempotency.service.ts)) uses **in-memory** LRU by default. With **`REDIS_URL` set**, `X-Idempotency-Key` replays are stored in Redis (TTL matches `IDEMPOTENCY_TTL_MS`) so **idempotency is consistent** across the fleet. Without Redis, use sticky sessions or a single node.

4. **Result / layer caches** (memory or SQLite) are **per-process**. Expect **lower hit rates** and more upstream DNS/SMTP work until you add a **shared cache** (Redis) or accept duplicate work.

## Async verify and webhooks (optional, in-process)

With **`ASYNC_VERIFY_JOBS_ENABLED=true`**, the service exposes `POST /v1/verify/jobs` (202 + `jobId`) and `GET /v1/verify/jobs/:id`. The queue is **in this Node process**; for **multiple** app nodes, put a **shared** queue (SQS, Redis, BullMQ) in front and treat this endpoint as a single-worker pattern or disable it. Optional **`callbackUrl`** on the job request receives a **signed** POST when the job completes (see [API.md](API.md)).

## Observability

Use `/v1/metrics` (histogram + counters) and external **APM** (p95 latency, error rate) for SLOs. See [API.md](API.md) for metric fields.
