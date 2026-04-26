# VerificationStation

[![CI](https://github.com/abdsmd/email_verification_service/actions/workflows/ci.yml/badge.svg)](https://github.com/abdsmd/email_verification_service/actions/workflows/ci.yml) [![Sync disposable domains](https://github.com/abdsmd/email_verification_service/actions/workflows/update-disposable-domains.yml/badge.svg)](https://github.com/abdsmd/email_verification_service/actions/workflows/update-disposable-domains.yml)

**VerificationStation** is a production-oriented **Node.js (Fastify) HTTP service** for **email address verification**: syntax, DNS/MX resolution, policy signals (disposable/role), optional catch-all probes, and **real** SMTP `RCPT TO` probing. It is designed to run on a **VPS** and be called by your control plane or app.

| | |
|---|--|
| **Repository** | **[github.com/abdsmd/email_verification_service](https://github.com/abdsmd/email_verification_service)** |
| **Stack** | Node.js ≥ 22, Fastify 5, TypeScript, Zod, pino, PM2 |
| **Real network I/O** | Uses Node’s **`dns/promises`** and **`net` TCP** to MX hosts (no fake / simulated SMTP) |
| **Docs (deploy)** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Ubuntu 22.04, Nginx, UFW, upgrades |
| **Docker** | [docs/DOCKER.md](docs/DOCKER.md) — [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml), data on host `./data` |
| **One-shot install** | [install-ubuntu-22.04.sh](install-ubuntu-22.04.sh) in the **repository root** (clone from GitHub, then run the script; see [§5](#5-production-step-by-step-ubuntu-2204)) |
| **Disposable list** | [GitHub Action](.github/workflows/update-disposable-domains.yml) **or** in-process **[`node-cron`](https://www.npmjs.com/package/node-cron)** (`DISPOSABLE_LIST_CRON_*`) merges the [vetted blocklist](https://github.com/disposable-email-domains/disposable-email-domains) and [disposable/disposable **`domains.txt`**](https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt) (see [§1.7](#17-disposable-domain-list)) |

---

## Author & open source

| | |
|---|--|
| **Name** | **Abdus Samad** |
| **Contact** | [abdsmd@gmail.com](mailto:abdsmd@gmail.com) |
| **License** | [MIT](LICENSE) — you may use, modify, and self-host the software. |

**Managed service (optional):** The software is free to self-host. If you prefer **not** to run it yourself, you can [email Abdus](mailto:abdsmd@gmail.com) to ask about a **managed** deployment (hosting, updates, and day‑to‑day operation—scope and terms by agreement).

This repository is intended to be **public** so others can **clone, install, and run** VerificationStation on their own infrastructure. This README walks through **local development**, **server installation**, the **HTTP API** (with sample requests and JSON responses), and where to go next.

**Source code layout (for contributors)**

| Path | Role |
|------|------|
| [src/server.ts](src/server.ts) | Process lifecycle, listen, shutdown |
| [src/app.ts](src/app.ts) | Fastify app, routes, plugins |
| [src/routes/](src/routes/) | HTTP handlers; entry [`register-routes.ts`](src/routes/register-routes.ts) wires `verify`, `batch`, `usage`, `verify-jobs`, `health`, `cache`, `metrics`, `cooldown` |
| [src/services/](src/services/) | Verification pipeline, DNS/MX, SMTP, cache, scoring, provider cooldown |
| [src/middleware/](src/middleware/) | Auth, HMAC, rate limit, error / not-found JSON |
| [src/config/](src/config/) | Environment schema, aliases, public routes |
| [src/jobs/](src/jobs/) | In-process work (e.g. [`node-cron`](https://www.npmjs.com/package/node-cron) disposable list scheduler, shared merge in [`mergeDisposableDomainSources.ts`](src/jobs/mergeDisposableDomainSources.ts)) |
| [src/cli/](src/cli/) | One-off entrypoints (e.g. [`update-disposable-list.ts`](src/cli/update-disposable-list.ts) for the same merge as the server) |
| [tests/](tests/) | Vitest unit and contract tests |

**Making the GitHub (or GitLab) repository public**

1. Push this project to a remote: `git remote add origin https://github.com/abdsmd/email_verification_service.git` then `git push -u origin main` (if the remote is not set yet).
2. On GitHub: **Settings → General → Danger zone → Change repository visibility → Public**.
3. Do **not** commit secrets. Use `.env` on the server only (or your secret store). See [.env.example](.env.example).

---

## Table of contents

1. [Features](#1-features)  
   - [1.1 Verification pipeline](#11-verification-pipeline) · [1.2 DNS and MX](#12-dns-mx-and-routing) · [1.3 Policy](#13-policy-disposable-role-catch-all) · [1.4 SMTP](#14-smtp-mailbox-probes)  
   - [1.5 API](#15-http-api) · [1.6 Caching and ops](#16-caching-metrics-and-operations) · [1.7 Disposable domain list (sources & sync)](#17-disposable-domain-list) · [1.8 PWA](#18-progressive-web-app) · [1.9 Security](#19-security)  
2. [What this service does *not* do](#2-what-this-service-does-not-do)  
3. [Requirements](#3-requirements)  
4. [Quick start (local development)](#4-quick-start-local-development)  
   - [4.1 Docker](#41-docker)  
5. [Production: step-by-step (Ubuntu 22.04)](#5-production-step-by-step-ubuntu-2204)  
6. [Configuration (environment)](#6-configuration-environment)  
7. [HTTP API](#7-http-api)  
8. [Verification result `code` values](#8-verification-result-code-values)  
   - [8.1 Integrator decision guide (`code` → product action)](#81-integrator-decision-guide-code--product-action)  
9. [Scoring and deliverability (optional fields)](#9-scoring-and-deliverability-optional-fields)  
10. [SMTP behaviour (summary)](#10-smtp-behaviour-summary)  
11. [Provider cooldown](#11-provider-cooldown)  
12. [Development: tests and quality](#12-development-tests-and-quality)  
13. [Troubleshooting](#13-troubleshooting)  
14. [Contributing and support](#14-contributing-and-support)

---

## 1. Features

VerificationStation is a **single process** you run on a VPS. It answers “can we reach a mailbox for this address?” with **stacked checks** and returns structured JSON (`code`, optional `score` / `deliverability`).

### 1.1 Verification pipeline

- **Syntax** and normalization of mailbox strings (local part + domain) before any network I/O.  
- **Layered flow**: format → DNS/MX → policy signals → (optional) SMTP `RCPT TO` against the real recipient MX.  
- **Result vocabulary**: stable `code` values (`valid`, `dead`, `retry_later`, `disposable`, `catch_all`, `unknown`, etc.) and optional heuristics for product use.

### 1.2 DNS, MX, and routing

- **MX resolution** with configurable timeouts, retries, and **multi-level caching** (memory or SQLite) for MX, domain existence, and negative paths.  
- **Per-provider behaviour** (large freemail) via classification and throttling, not a single code path for every host.

### 1.3 Policy (disposable, role, catch-all)

- **Disposable domains**: file-driven blocklist merged at startup from [`src/data/disposable-domains.txt`](src/data/disposable-domains.txt) and optional `DISPOSABLE_LIST_PATH` (one domain per line); if `DISPOSABLE_LIST_CRON_*` is enabled, the list can **refresh in memory** after a scheduled upstream sync without restart.  
- **Role / plus patterns** and similar policy using [`src/data/role-prefixes.txt`](src/data/role-prefixes.txt).  
- **Catch-all** detection (optional, configurable) to flag risky “accepts anything” domains.

### 1.4 SMTP mailbox probes

- **Real TCP** to recipient MX, typically **port 25** — EHLO/HELO, `MAIL FROM`, `RCPT TO` with reply classification (greylist, 4xx/5xx, provider-specific behaviour, `retry_later` where the remote is non-committal).  
- **Provider cooldown** to avoid hammering the same big MX; inspectable and resettable via the HTTP API.  
- **Tunable** per env: skip SMTP, skip catch-all, or force refresh on a per-request basis.

### 1.5 HTTP API

- **`POST /v1/verify`** — single address.  
- **`POST /v1/verify/batch`** — many addresses with dedupe, domain grouping, bounded concurrency, and per-row error isolation.  
- **`GET /v1/usage`** — per-tenant usage counters (when metrics are enabled; see [docs/USAGE_BILLING.md](docs/USAGE_BILLING.md)).  
- **Async (optional):** `POST /v1/verify/jobs` + `GET /v1/verify/jobs/:id` and optional signed webhooks when `ASYNC_VERIFY_JOBS_ENABLED` — [docs/API.md](docs/API.md).  
- **Health and ops**: `GET /health`, `GET /v1/ready`, `GET /v1/metrics`, cache stats/clear, cooldown read/reset.  
- **Reference**: [docs/API.md](docs/API.md), [Postman collection](postman/VerificationStation.postman_collection.json).

### 1.6 Caching, metrics, and operations

- **Result and layer caches** (memory or **SQLite**), optional **provider-cooldown persistence** on disk.  
- **Structured JSON logging**; optional log redaction for addresses.  
- **Process lifecycle**: configurable shutdown grace, rate limiting, request size limits.  
- **Deploy**: [Docker](docs/DOCKER.md) with host-mounted `./data`, [PM2](ecosystem.config.js) / [Ubuntu install script](install-ubuntu-22.04.sh), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Nginx and TLS.  
- **Default bind** `127.0.0.1` (loopback) unless you set `HOST=0.0.0.0` (e.g. container port publishing).

### 1.7 Disposable domain list

- **Source of truth in Git**: [`src/data/disposable-domains.txt`](src/data/disposable-domains.txt) is the **deduplicated union** of:  
  1. [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) — **`disposable_email_blocklist.conf`** (community-vetted, PyPI-style scope).  
  2. [disposable/disposable](https://github.com/disposable/disposable) **published** list — **`domains.txt`** from the companion mirror repo [disposable/disposable-email-domains](https://github.com/disposable/disposable-email-domains) (large, [auto-updated about every 24h](https://github.com/disposable/disposable), broad coverage; may include more aggressive matches than the first list).  
- **Why two lists**: the first reduces false positives; the second (from the [disposable](https://github.com/disposable/disposable) pipeline) widens net against new throwaway domains. Overlap is merged once.  
- **Manual refresh**: `npm run update:disposable-list` (runs [`src/cli/update-disposable-list.ts`](src/cli/update-disposable-list.ts) via `tsx`; needs network; after `npm run build`, `node dist/cli/update-disposable-list.js` also works).  
- **Automatic daily update in the running process (production default):** set **`DISPOSABLE_LIST_CRON_*`** env vars; the app uses [`node-cron`](https://www.npmjs.com/package/node-cron) to fetch both upstream lists, write [`src/data/disposable-domains.txt`](src/data/disposable-domains.txt) when content changes, and **reload the in-memory set** (no PM2 restart). Unset / empty `DISPOSABLE_LIST_CRON_ENABLED` means **on in production, off in dev** (override with `true` / `false`).  
- **Automatic daily update on GitHub**: workflow [`.github/workflows/update-disposable-domains.yml`](.github/workflows/update-disposable-domains.yml) runs on a **schedule** (default **06:15 UTC** daily) and on **manual** `workflow_dispatch` (`npm ci` + same merge as the app). If the file changes, **github-actions[bot]** commits the update.  
- **On your server**: if you deploy list updates **via Git** only, `git pull` then **`pm2 reload`** to load the new file. If you use **in-process** sync, outbound **HTTPS** to `raw.githubusercontent.com` must be allowed.  
- **Branch protection** on `main`: either allow the workflow to push, or use a **pull request**-based action (e.g. [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)) and merge when ready.

### 1.8 Progressive web app

- **Optional** static shell: `manifest`, service worker, simple health/verify UI at `/` when `PWA_ENABLED` is on. Disable for API-only.

### 1.9 Security

- **Optional `Authorization: Bearer`**, second-factor **HMAC** on mutating routes, **IP allowlist**, **Helmet**, **global rate limit**, size-capped JSON bodies, consistent JSON error shape.  
- **Network**: no inbound requirement beyond your reverse proxy; **outbound** needs DNS and (for SMTP) TCP **25**; for disposable list refresh (scheduled or manual), **HTTPS 443** to `raw.githubusercontent.com` (or disable with `DISPOSABLE_LIST_CRON_ENABLED=false` and deploy lists via Git only).

---

## 2. What this service does *not* do

- It is **not** a bulk mailer or full MTA.  
- It does **not** guarantee inbox placement — only what the remote MX returns at probe time.  
- It does **not** skip greylists or provider defences — many cases return **`retry_later`** or **`greylisted`**, not a hard “invalid”.

---

## 3. Requirements

| Requirement | Notes |
|-------------|--------|
| **Node.js** | **≥ 22** (see [package.json](package.json) `engines`) |
| **Build** (for `better-sqlite3`) | C++ toolchain and Python 3 on Linux when using `npm ci` (the [install script](install-ubuntu-22.04.sh) installs `build-essential` and `python3`) |
| **Network** (production) | **Outbound TCP 25** to reach recipient MX; **DNS (53/udp+tcp)**; **HTTPS 443** to the internet (Certbot, package mirrors, and **when refreshing disposable lists** — in-process or `npm run update:disposable-list` fetches from `raw.githubusercontent.com`) |
| **Identity for SMTP** | A domain you control for **HELO** / `MAIL FROM` (see [Environment](#6-configuration-environment)) |

---

## 4. Quick start (local development)

**Step 1 — Clone the repository**

```bash
git clone https://github.com/abdsmd/email_verification_service.git verification-station
cd verification-station
```

**Step 2 — Install Node.js 22+**  
Use [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or your OS package manager. Verify:

```bash
node -v   # should print v22.x or newer
```

**Step 3 — Install dependencies**

```bash
npm install
```

**Step 4 — Environment file**

```bash
cp .env.example .env
# Edit .env: at minimum, for local testing you can leave many defaults.
# For protected routes in production, set STATION_SECRET or API_KEY.
```

**Step 5 — Build and run**

```bash
npm run build
npm start
# Default: http://127.0.0.1:8090  (see HOST and PORT in `.env`; `0.0.0.0` only if you need non-loopback, e.g. Docker)
# With NODE_ENV=development, in-process disposable list sync (node-cron) is off unless you set DISPOSABLE_LIST_CRON_ENABLED=true in `.env` (optional for testing; needs HTTPS outbound to GitHub).
```

**Step 6 — Health check**

```bash
curl -sS http://127.0.0.1:8090/health
```

**Expected response (JSON):**

```json
{ "ok": true, "service": "verification-station" }
```

**Step 7 — (Optional) Run tests**

```bash
npm run typecheck
npm run lint
npm test
```

### 4.1 Docker

Run the API in Docker with **SQLite cache and data files on the host** (directory `./data` next to `docker-compose.yml`).

1. `cp docker/.env.example .env` and set production values (`STATION_SECRET`, `HELO_DOMAIN`, `MAIL_FROM` or `MAIL_FROM_DOMAIN`, etc.).  
2. `docker compose up -d --build`  
3. `curl -sS http://127.0.0.1:8090/health` (or your `PORT` from `.env`).

Compose uses **`CACHE_BACKEND=sqlite`**, writes **`/app/data/verification-station.db`**, and enables **`PROVIDER_COOLDOWN_PERSIST`** so cache and provider cooldown survive container restarts. An **entrypoint** seeds list/JSON files into `./data` the first time the directory is empty.

`NODE_ENV=production` in the image **enables in-process `node-cron` disposable list sync by default** (see `DISPOSABLE_LIST_CRON_*` in [`.env.example`](.env.example)). The merged file is written under `DATA_DIR` (default `data` → `/app/data` in the container). If the container has **no outbound HTTPS** to `raw.githubusercontent.com`, set **`DISPOSABLE_LIST_CRON_ENABLED=false`** and update the list from Git/CI or run `node dist/cli/update-disposable-list.js` (after `build`) in a one-off `docker exec` when you have network.

Details: [docs/DOCKER.md](docs/DOCKER.md).

---

## 5. Production: step-by-step (Ubuntu 22.04)

For a full server guide (Nginx, TLS, UFW, upgrades), read **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Below is the short path using the **root** install script.

**GitHub (clone source):** `https://github.com/abdsmd/email_verification_service`

### 5.1 Install script from GitHub (`install-ubuntu-22.04.sh`)

On **Ubuntu 22.04**, after you have **git** and **sudo**:

```bash
git clone https://github.com/abdsmd/email_verification_service.git verification-station
cd verification-station
chmod +x install-ubuntu-22.04.sh
export SETUP_NGINX=0   # set to 1 if you want the script to configure Nginx
export SETUP_UFW=0     # set to 1 if you want UFW rules
sudo ./install-ubuntu-22.04.sh
```

The script refreshes packages, installs Node 22, creates the `verification` user (when not using a custom flow), runs `npm ci`, tests, `npm run build`, PM2, and optional Nginx/UFW per **docs/DEPLOYMENT.md**. Then edit `.env` on the server (see below).

### 5.2 One-command bootstrap (manual directory layout on a fresh 22.04 server)

Use this if you prefer the app under **`/opt/verification-station`** (same end result as cloning into a named folder).

1. **SSH** into the server.  
2. **Install git** and clone this repo to `/opt/verification-station` (or set `APP_DIR` when running the script):

```bash
sudo apt-get update
sudo apt-get -y full-upgrade
sudo apt-get -y install git
cd /opt
sudo mkdir -p verification-station
sudo chown "$USER":"$USER" verification-station
cd verification-station
git clone https://github.com/abdsmd/email_verification_service.git .
```

3. **Run the installer** (it updates the OS, installs Node 22 from NodeSource, creates user `verification`, runs `npm ci` / `test` / `build`, installs PM2, optional Nginx/UFW):

```bash
chmod +x install-ubuntu-22.04.sh
export SETUP_NGINX=0
export SETUP_UFW=0
sudo ./install-ubuntu-22.04.sh
```

4. **Edit secrets** on the server:

```bash
sudo -iu verification
nano /opt/verification-station/.env
```

Set at least **`STATION_SECRET`** (or `API_KEY`), **`HELO_DOMAIN`**, **`MAIL_FROM`** (or `MAIL_FROM_DOMAIN`), and tune concurrency. **Disposable lists:** in production, **`DISPOSABLE_LIST_CRON_*`** defaults (see [§6](#6-configuration-environment)) keep the in-process schedule **on** unless you set `DISPOSABLE_LIST_CRON_ENABLED=false` (e.g. if you only update [`src/data/disposable-domains.txt`](src/data/disposable-domains.txt) through Git and `git pull` + `pm2 reload`). Save and exit.

5. **Reload the app process**

```bash
cd /opt/verification-station
pm2 reload ecosystem.config.js
```

6. **Smoke test**

```bash
curl -sS http://127.0.0.1:8090/health
```

7. **PM2 on reboot** — run the **exact** `sudo env PATH=...` line printed once by `pm2 startup` (the script also reminds you; see [DEPLOYMENT.md](docs/DEPLOYMENT.md)).

---

## 6. Configuration (environment)

Configuration is loaded with **dotenv-flow** (e.g. `.env`, `.env.production`, `.env.local`). The canonical list of variable names and comments is in **[.env.example](.env.example)**.

| Variable | Purpose (short) |
|----------|-----------------|
| `HOST` / `PORT` | Bind address (default **`127.0.0.1`**) and port. Use `0.0.0.0` only for Docker / all-interfaces; production behind Nginx should keep `127.0.0.1` |
| `STATION_SECRET` or `API_KEY` | `Authorization: Bearer <token>` on protected routes when set |
| `HMAC_SECRET` | Optional second layer: signed mutating requests (see [docs/API.md#authentication](docs/API.md#authentication)) |
| `TRUST_PROXY` | Set `true` behind Nginx if you use `X-Forwarded-*` (and often `IP_ALLOWLIST`) |
| `REQUEST_BODY_MAX_BYTES` | Max JSON body (default 1 MiB) |
| `MAX_CONCURRENCY` / batch limits / `MAX_CONCURRENT_PER_PROVIDER` | Back-pressure for verify pipeline |
| `SMTP_*` / `DNS_*` | Timeouts and retries for real network calls |
| `CACHE_*` / `SQLITE_PATH` | Memory vs SQLite cache and optional SQLite path |
| `DISPOSABLE_LIST_PATH` | Optional path to *extra* disposable domains (one per line), merged with [src/data/disposable-domains.txt](src/data/disposable-domains.txt) (merged vetted + [disposable/disposable](https://github.com/disposable/disposable) list; refresh: `npm run update:disposable-list` or in-process cron) |
| `DISPOSABLE_LIST_CRON_ENABLED` | In-process `node-cron` sync of upstream lists. Unset: **true** when `NODE_ENV=production`, else **false**; set `0`/`false` to disable in prod. |
| `DISPOSABLE_LIST_CRON_SCHEDULE` | 5-field cron (default `15 6 * * *` — 06:15 daily, see `node-cron` / your timezone) |
| `DISPOSABLE_LIST_CRON_TIMEZONE` | IANA zone for the schedule (default `UTC`) |
| `LOG_FULL_EMAIL` | Default `false` — redact addresses in error logs; set `true` only for debugging |
| `TENANT_KEYS_JSON` | Optional. Multi-tenant API keys (array of `bearer`, `id`, optional `rateLimitRpm`); when set, replaces single-key auth — see [docs/PRODUCT.md](docs/PRODUCT.md) |
| `VERIFICATION_EXPLAIN_ENABLED` | Default `true` in env schema — add `explain` + `confidence` to verification JSON when enabled |
| `API_DOCS_ENABLED` | OpenAPI + Swagger UI at `/v1/docs` when `true` |
| `IDEMPOTENCY_TTL_MS` / `IDEMPOTENCY_MAX_ENTRIES` | In-memory idempotency for `X-Idempotency-Key` on verify/batch |
| `SLOW_REQUEST_THRESHOLD_MS` / `METRICS_LATENCIES_MAX` | Slow verify counter and rolling latency buffer for p50/p95 in metrics |
| `AUDIT_LOG_PATH` | Optional append-only file for admin actions (cache clear, cooldown reset) |
| `VERIFICATION_SIGNALS_ENABLED` | When `true`, responses may include `signals` (`highRiskTld`, `possibleTypoOf`) — hints only, not a block on their own |
| `MX_RCPT_TRANSIENT_FALLBACK_*` | If enabled (default off), for **non-big** mail: transient/greylist RCPT on an MX can try the next MX (see `MAX_EXTRA` cap) — abuse-sensitive; test before production |
| `SMTP_RETRY_BIG_PROVIDER_MULT` | Multiplier for inter-retry delay on **big** freemail (default `1` = same as `SMTP_RETRY_BASE_DELAY_MS`); set `>1` to back off more under throttling |
| `REDIS_URL` | Optional. Shared Redis for **rate limiting** and **idempotency** when running **multiple** app instances |
| `ASYNC_VERIFY_JOBS_ENABLED` | When `true`, enables `POST /v1/verify/jobs` (202) and `GET /v1/verify/jobs/:id` (in-process queue; see [docs/SCALING.md](docs/SCALING.md)) |
| `ASYNC_JOBS_MAX` | Max stored async jobs (pending + terminal); evicts oldest completed/failed when full |
| `WEBHOOK_SIGNING_SECRET` | HMAC key for async job **callbackUrl** webhooks; falls back to `HMAC_SECRET` if unset |

Ops-style **aliases** (e.g. `API_PORT` → `PORT`) are in [src/config/env-aliases.ts](src/config/env-aliases.ts). A production-oriented sample: [env.production.example](env.production.example).

---

## 7. HTTP API

**Versioning and deprecation:** All routes live under `/v1`. **Non-breaking** changes may add fields or stricter validation; **breaking** changes ship as a new prefix (e.g. `/v2`) with a migration window. See [docs/API.md – API versioning and deprecation](docs/API.md#api-versioning-and-deprecation).

**Usage / billing (what to meter):** [docs/USAGE_BILLING.md](docs/USAGE_BILLING.md) and **`GET /v1/usage`**. **SLOs and canaries:** [docs/SYNTHETIC_SLO.md](docs/SYNTHETIC_SLO.md).

**One-page reference (routes, auth, bodies, errors):** [docs/API.md](docs/API.md)

**Postman:** Import [postman/VerificationStation.postman_collection.json](postman/VerificationStation.postman_collection.json) (**File → Import** in Postman). Set collection variables **`baseUrl`** (e.g. `http://127.0.0.1:8090`), **`bearerToken`** when auth is on, and **`jobId`** after creating an async job. Folders: **Public** (health, ready, metrics) and **Protected** (verify, batch, usage, verify/jobs, cache, cooldown).

---

## 8. Verification result `code` values

| `code` | Meaning (short) |
|--------|------------------|
| `valid` | RCPT (or path) accepted — likely exists at probe time |
| `dead` / `invalid` | Syntax or non-viable local/domain |
| `undeliverable` | Definitive “no” (DNS or stable 5xx semantics, etc.) |
| `unknown` | Inconclusive (e.g. 252, routing ambiguity) |
| `retry_later` | Transient: timeouts, 421, many provider / policy cases |
| `greylisted` | Temporary mailbox / 4xx patterns |
| `mx_unreachable` | MX / path not usable from this host |
| `provider_blocked` | Station-level provider cooldown (see §11) |
| `disposable` / `role_account` | Policy flags |
| `catch_all` | Accepts unprovisioned addresses (risky) |
| `system_error` | Internal / batch row failure — not a mailbox verdict |

**RCPT at probe time ≠ inbox guarantee.** The API proves routability and mailbox response semantics where observable; it does not prove later placement, tab, or engagement. See [§2](#2-what-this-service-does-not-do).

**Score and deliverability** are **omitted** for intentionally inconclusive rows (e.g. many `retry_later` / `greylisted` cases); see [scoring.service.ts](src/services/scoring.service.ts).

### 8.1 Integrator decision guide (`code` → product action)

Use this to map API outcomes to **signup, CRM, and risk** flows (document in your own runbooks; tune to your product).

| `code` | Suggested product action |
|--------|-------------------------|
| `valid` | Treat as *likely reachable*; allow signup per your policy; do not equate to marketing consent or guaranteed inbox. |
| `invalid` / `dead` | Reject or prompt correction before submit. |
| `undeliverable` | Do not message; keep out of “active” lists unless user proves another channel. |
| `unknown` | Do not hard-block; optional manual review; consider magic-link or secondary verification. |
| `retry_later` / `greylisted` | Defer final decision: queue async re-check, backoff, or use non-SMTP verification (OTP, magic link). **Avoid blocking signup** on a single `retry_later` from large freemail. |
| `mx_unreachable` | Treat as *cannot verify from this infrastructure*; optional retry or alternate channel. |
| `provider_blocked` | Back off; show “try again later” or route to alternate verification path. |
| `disposable` / `role_account` | Enforce your policy (block, step-up, or accept with risk). |
| `catch_all` | High false-positive risk for existence; require corroboration or stricter rules. |
| `system_error` | Retry with idempotency; if persistent, **your** incident path — not a mailbox verdict. |

Deeper product positioning: [docs/PRODUCT.md](docs/PRODUCT.md). One-page copy for API users: [docs/API.md#integrator-decision-guide](docs/API.md#integrator-decision-guide).

---

## 9. Scoring and deliverability (optional fields)

When present:

- **`score`**: integer **0–100** (heuristic).  
- **`deliverability`**: one of `deliverable` | `risky` | `unknown` | `undeliverable`.  

Tuning for disposable/role: `DISPOSABLE_DELIVERABILITY`, `ROLE_ACCOUNT_DELIVERABILITY` in env.

---

## 10. SMTP behaviour (summary)

- Uses **real** TCP to recipient MX, typically port **25**.  
- Classifies multiline replies; **4xx** / greylist / many **5xx** policy cases map to **retry** / **unknown**, not always “invalid”.  
- **Provider** rate limits and **cooldown** reduce hammering large freemail MX.  

Exact mapping: [verification.service.ts](src/services/verification.service.ts) (`mapSmtpToResult`), [smtp-code-parser.service.ts](src/services/smtp-code-parser.service.ts) (`classifySmtp`).

---

## 11. Provider cooldown

For large providers, the service may **throttle** SMTP opens and **back off** on timeouts / policy / repeated soft codes.  
Inspect `GET /v1/cooldown` or clear via `POST /v1/cooldown/reset` (admin).  
Disable gating only for debugging: `PROVIDER_COOLDOWN_ENABLED=false` (not recommended in production for big providers).

---

## 12. Development: tests and quality

| Command | Purpose |
|---------|---------|
| `npm run dev` | `tsx watch` on [src/server.ts](src/server.ts) |
| `npm run build` | tsup: `dist/server.js` and `dist/cli/update-disposable-list.js` (CLI merge target) |
| `npm start` | `node dist/server.js` (starts in-process [node-cron](https://www.npmjs.com/package/node-cron) when `DISPOSABLE_LIST_CRON_ENABLED` and production; see [§1.7](#17-disposable-domain-list)) |
| `npm test` | Vitest (deterministic; no live network by default) |
| `LIVE_NETWORK=1 npm test` | Opt-in real DNS integration test (needs network) |
| `npm run update:disposable-list` | Manual merge: same logic as the scheduler and [`.github/workflows/update-disposable-domains.yml`](.github/workflows/update-disposable-domains.yml) ([tsx](https://github.com/privatenumber/tsx) → [`src/cli/update-disposable-list.ts`](src/cli/update-disposable-list.ts)); **needs outbound HTTPS** to `raw.githubusercontent.com`. After `npm run build`, you can also run `node dist/cli/update-disposable-list.js` (no `tsx` required). |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run ci` | One-shot **typecheck → lint → test → build** (same sequence as [CI](.github/workflows/ci.yml)) |

**Before a release push:** run `npm run ci`; confirm no secrets in the diff; keep `.env` out of version control (see [.gitignore](.gitignore), [.env.example](.env.example) only in repo).

---

## 13. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| `401` | `Authorization: Bearer` missing or wrong; `STATION_SECRET` / `API_KEY` on server |
| `403` (HMAC) | `X-Timestamp` / `X-Signature` / `X-Request-Id`, clock skew, body bytes must match signed string |
| `403` (IP) | `IP_ALLOWLIST` + `TRUST_PROXY` behind Nginx |
| `429` | `RATE_LIMIT_MAX` / window |
| All `retry_later` to big providers | Normal under rate limits; check cooldown and your IP / VPS reputation |
| `better-sqlite3` build errors on Linux | Install `build-essential`, `python3`; use Node 22 LTS |
| No outbound SMTP | Firewall / cloud security group must allow **egress TCP 25** and **DNS** |
| Disposable list never updates in-process / manual merge fails | Allow **egress HTTPS 443** to `raw.githubusercontent.com`, or set `DISPOSABLE_LIST_CRON_ENABLED=false` and use Git/CI for [`disposable-domains.txt`](src/data/disposable-domains.txt); confirm `DATA_DIR` points at the file the server loads |
| `git pull` for list file but old behaviour | **`pm2 reload`** (or restart) to reload from disk if you are **not** using in-process sync; in-process sync reloads memory automatically when the file changes |

---

## 14. Contributing and support

- **Author:** Abdus Samad — [abdsmd@gmail.com](mailto:abdsmd@gmail.com)  
- **Managed service:** same contact if you want this stack run for you; see the note under [Author & open source](#author--open-source) above.  
- Issues, forks, and pull requests are welcome for this public project.  
- For deployment detail beyond this README, use **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** and **[install-ubuntu-22.04.sh](install-ubuntu-22.04.sh)**.

---

*VerificationStation — MIT License. Copyright (c) 2026 Abdus Samad.*
