# VerificationStation

**VerificationStation** is a production-oriented **Node.js (Fastify) HTTP service** for **email address verification**: syntax, DNS/MX resolution, policy signals (disposable/role), optional catch-all probes, and **real** SMTP `RCPT TO` probing. It is designed to run on a **VPS** and be called by your control plane or app.

| | |
|---|--|
| **Stack** | Node.js ≥ 22, Fastify 5, TypeScript, Zod, pino, PM2 |
| **Real network I/O** | Uses Node’s **`dns/promises`** and **`net` TCP** to MX hosts (no fake / simulated SMTP) |
| **Docs (deploy)** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Ubuntu 22.04, Nginx, UFW, upgrades |
| **One-shot install** | [install-ubuntu-22.04.sh](install-ubuntu-22.04.sh) in the **repository root** |

---

## Author & open source

| | |
|---|--|
| **Name** | **Abdus Samad** |
| **Contact** | [abdsmd@gmail.com](mailto:abdsmd@gmail.com) |
| **License** | [MIT](LICENSE) — you may use, modify, and self-host the software. |

This repository is intended to be **public** so others can **clone, install, and run** VerificationStation on their own infrastructure. This README walks through **local development**, **server installation**, the **HTTP API** (with sample requests and JSON responses), and where to go next.

**Source code layout (for contributors)**

| Path | Role |
|------|------|
| [src/server.ts](src/server.ts) | Process lifecycle, listen, shutdown |
| [src/app.ts](src/app.ts) | Fastify app, routes, plugins |
| [src/routes/](src/routes/) | HTTP handlers (`verify`, `batch`, `health`, `cache`, `metrics`, `cooldown`) |
| [src/services/](src/services/) | Verification pipeline, DNS/MX, SMTP, cache, scoring, provider cooldown |
| [src/middleware/](src/middleware/) | Auth, HMAC, rate limit, error / not-found JSON |
| [src/config/](src/config/) | Environment schema, aliases, public routes |
| [tests/](tests/) | Vitest unit and contract tests |

**Making the GitHub (or GitLab) repository public**

1. Push this project to a remote: `git remote add origin <your-url>` then `git push -u origin main`.
2. On GitHub: **Settings → General → Danger zone → Change repository visibility → Public**.
3. Do **not** commit secrets. Use `.env` on the server only (or your secret store). See [.env.example](.env.example).

---

## Table of contents

1. [Features](#1-features)  
2. [What this service does *not* do](#2-what-this-service-does-not-do)  
3. [Requirements](#3-requirements)  
4. [Quick start (local development)](#4-quick-start-local-development)  
5. [Production: step-by-step (Ubuntu 22.04)](#5-production-step-by-step-ubuntu-2204)  
6. [Configuration (environment)](#6-configuration-environment)  
7. [HTTP API reference](#7-http-api-reference)  
8. [Verification result `code` values](#8-verification-result-code-values)  
9. [Scoring and deliverability (optional fields)](#9-scoring-and-deliverability-optional-fields)  
10. [SMTP behaviour (summary)](#10-smtp-behaviour-summary)  
11. [Provider cooldown](#11-provider-cooldown)  
12. [Development: tests and quality](#12-development-tests-and-quality)  
13. [Troubleshooting](#13-troubleshooting)  
14. [Contributing and support](#14-contributing-and-support)

---

## 1. Features

- **Syntax** validation of mailbox strings.  
- **DNS**: MX lookup with caching; optional checks that MX hostnames resolve (A/AAAA).  
- **Policy**: disposable domain list, role-like local parts, optional **catch-all** detection.  
- **SMTP** (optional): real TCP connection to port **25**, EHLO/HELO, MAIL FROM, RCPT TO; replies classified (greylist, provider block, permanent reject, etc.).  
- **API**: `POST /v1/verify`, `POST /v1/verify/batch` (dedupe, domain grouping, `Promise.allSettled`-style row safety), health, metrics, cache/cooldown admin.  
- **Security** (configurable): Bearer token, optional **HMAC** request signing, optional IP allowlist, Helmet, body size cap, global rate limit, structured JSON errors.

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
| **Network** (production) | **Outbound TCP 25** to reach recipient MX; **DNS (53/udp+tcp)**; **HTTPS 443** for package installs / optional Certbot |
| **Identity for SMTP** | A domain you control for **HELO** / `MAIL FROM` (see [Environment](#6-configuration-environment)) |

---

## 4. Quick start (local development)

**Step 1 — Clone the repository**

```bash
git clone <repository-url> verification-station
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
# Default: http://0.0.0.0:8080  (see HOST and PORT in .env)
```

**Step 6 — Health check**

```bash
curl -sS http://127.0.0.1:8080/health
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

---

## 5. Production: step-by-step (Ubuntu 22.04)

For a full server guide (Nginx, TLS, UFW, upgrades), read **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Below is the short path using the **root** install script.

### 5.1 One-command bootstrap (as a sudo user on a fresh 22.04 server)

1. **SSH** into the server.  
2. **Install git** and clone this repo to `/opt/verification-station` (or set `APP_DIR`):

```bash
sudo apt-get update
sudo apt-get -y full-upgrade
sudo apt-get -y install git
cd /opt
sudo mkdir -p verification-station
sudo chown "$USER":"$USER" verification-station
cd verification-station
git clone <YOUR-REPO-URL> .
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

Set at least **`STATION_SECRET`** (or `API_KEY`), **`HELO_DOMAIN`**, **`MAIL_FROM`** (or `MAIL_FROM_DOMAIN`), and tune concurrency. Save and exit.

5. **Reload the app process**

```bash
cd /opt/verification-station
pm2 reload ecosystem.config.js
```

6. **Smoke test**

```bash
curl -sS http://127.0.0.1:8080/health
```

7. **PM2 on reboot** — run the **exact** `sudo env PATH=...` line printed once by `pm2 startup` (the script also reminds you; see [DEPLOYMENT.md](docs/DEPLOYMENT.md)).

---

## 6. Configuration (environment)

Configuration is loaded with **dotenv-flow** (e.g. `.env`, `.env.production`, `.env.local`). The canonical list of variable names and comments is in **[.env.example](.env.example)**.

| Variable | Purpose (short) |
|----------|-----------------|
| `HOST` / `PORT` | Bind address and port (use `127.0.0.1` behind Nginx) |
| `STATION_SECRET` or `API_KEY` | `Authorization: Bearer <token>` on protected routes when set |
| `HMAC_SECRET` | Optional second layer: signed mutating requests (see [§7.2](#72-authentication)) |
| `TRUST_PROXY` | Set `true` behind Nginx if you use `X-Forwarded-*` (and often `IP_ALLOWLIST`) |
| `REQUEST_BODY_MAX_BYTES` | Max JSON body (default 1 MiB) |
| `MAX_CONCURRENCY` / batch limits / `MAX_CONCURRENT_PER_PROVIDER` | Back-pressure for verify pipeline |
| `SMTP_*` / `DNS_*` | Timeouts and retries for real network calls |
| `CACHE_*` / `SQLITE_PATH` | Memory vs SQLite cache and optional SQLite path |
| `LOG_FULL_EMAIL` | Default `false` — redact addresses in error logs; set `true` only for debugging |

Ops-style **aliases** (e.g. `API_PORT` → `PORT`) are in [src/config/env-aliases.ts](src/config/env-aliases.ts). A production-oriented sample: [env.production.example](env.production.example).

---

## 7. HTTP API reference

**Base URL:** `http://<host>:<port>` (e.g. `https://verify-api.example.com` behind Nginx).

**Content type:** `Content-Type: application/json` for JSON bodies.

**Common error shape** (most failures):

```json
{
  "error": "validation_error | unauthorized | not_found | internal_error | …",
  "message": "optional human-readable (non-production 5xx may hide detail)",
  "details": { }
}
```

Unknown routes return:

```json
{ "error": "not_found", "method": "GET" }
```

### 7.1 Route overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Liveness |
| `GET` | `/v1/ready` | No | Readiness |
| `GET` | `/v1/metrics` | No* | Counters and uptime (404 if `METRICS_ENABLED=false`) |
| `POST` | `/v1/verify` | If token/HMAC set | Single email verification |
| `POST` | `/v1/verify/batch` | If set | Batch verification |
| `GET` | `/v1/cache/stats` | If set | Cache statistics |
| `POST` | `/v1/cache/clear` | If set | Clear cache namespace |
| `GET` | `/v1/cooldown` | If set | Provider cooldown snapshot |
| `POST` | `/v1/cooldown/reset` | If set | Reset cooldown(s) |

\*Secure `/v1/metrics` at the edge in production (no auth in app by default).

**Bearer auth:** if `STATION_SECRET` or `API_KEY` is set, protected routes need:

```http
Authorization: Bearer <same value as env>
```

`STATION_SECRET` wins if both are set.

**Public (no auth) paths** are only: `/health`, `/v1/ready`, `/v1/metrics` (see [src/config/public-routes.ts](src/config/public-routes.ts)).

### 7.2 Authentication (optional layers)

1. **Bearer** — see above.  
2. **HMAC** — if `HMAC_SECRET` is set, **non-GET/HEAD** requests to protected routes also need:  
   - `X-Timestamp` (Unix seconds, ms, or ISO)  
   - `X-Signature` — hex HMAC-SHA256 of string `` `${timestamp}.${rawBody}` ``  
   - `X-Request-Id` — unique per request; replays can return **409** after a success  

   Clock skew: `HMAC_SKEW_MS` (default 5 minutes).  
3. **IP allowlist** — if `IP_ALLOWLIST` is set, only listed client IPs are allowed (use `TRUST_PROXY=true` behind Nginx so the real client IP is seen).

### 7.3 `GET /health`

**Response `200`:**

```json
{ "ok": true, "service": "verification-station" }
```

### 7.4 `GET /v1/ready`

**Response `200`:**

```json
{ "ready": true }
```

### 7.5 `GET /v1/metrics`

**Response `200`** (when `METRICS_ENABLED=true`):

```json
{
  "verifyTotal": 42,
  "verifyBatch": 3,
  "errors": 0,
  "startedAt": 1700000000000,
  "uptimeMs": 3600000
}
```

**Response `404`** when metrics disabled:

```json
{ "error": "metrics_disabled" }
```

### 7.6 `POST /v1/verify`

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | 3–320 chars; trimmed and lowercased by API |
| `jobId` | string | No | Opaque id for your logging |
| `options` | object | No | `skipSmtp`, `skipCatchAll`, `forceRefresh` (all boolean, optional) |

**Example (minimal)**

```http
POST /v1/verify HTTP/1.1
Host: 127.0.0.1:8080
Authorization: Bearer your-secret
Content-Type: application/json

{
  "email": "user@example.com",
  "options": {}
}
```

**Example response `200` — mailbox accepted (illustrative; real `details` vary)**

```json
{
  "email": "user@example.com",
  "code": "valid",
  "message": "RCPT accept",
  "details": {
    "layer": "smtp",
    "smtp": 250,
    "semantic": "mailbox_ok"
  },
  "score": 100,
  "deliverability": "deliverable",
  "durationMs": 1842
}
```

**Example `200` — bad syntax (no outbound SMTP needed for “dead”)**

```json
{
  "email": "not-an-email",
  "code": "dead",
  "message": "syntax: local part: …"
}
```

**Example `200` — try again later (provider / greylist / transient path)**

```json
{
  "email": "user@gmail.com",
  "code": "retry_later",
  "message": "…",
  "details": { "reason": "provider_smtp" },
  "providerCooldownUntil": "2026-01-15T10:00:00.000Z"
}
```

**Response `400` — body validation**

```json
{
  "error": "validation_error",
  "details": {
    "formErrors": [],
    "fieldErrors": { "email": ["…"] }
  }
}
```

### 7.7 `POST /v1/verify/batch`

**Request body**

| Field | Type | Description |
|-------|------|-------------|
| `items` | array | At least 1; each item: `{ "email", "jobId"?, "options"? }` (same as single) |
| `options` | object | Default options for all rows (per-row `options` can override) |

Max array size: **10_000** hard cap in schema; also limited by `BATCH_MAX_ITEMS` in env (default 500).

**Example**

```json
{
  "items": [
    { "email": "a@example.com" },
    { "email": "b@other.org", "options": { "skipSmtp": true } }
  ],
  "options": { "forceRefresh": false }
}
```

**Response `200`**

```json
{
  "results": [
    {
      "email": "a@example.com",
      "code": "valid",
      "message": "…",
      "details": { },
      "durationMs": 1200
    },
    {
      "email": "b@other.org",
      "code": "unknown",
      "message": "MX OK; SMTP not executed",
      "details": { "mx": "mx1.other.org" },
      "score": 45,
      "deliverability": "risky",
      "durationMs": 80
    }
  ]
}
```

One result object is returned per **input row** (duplicates are verified once, then copied back). If an internal error affects one row, that row may have `"code": "system_error"`.

### 7.8 `GET /v1/cache/stats`

**Response `200` — memory backend**

```json
{
  "backend": "memory",
  "layers": {
    "result": 12,
    "mx": 45,
    "domain": 10,
    "dead": 2,
    "disposable": 1,
    "role": 0,
    "catchall": 0,
    "providerCooldown": 0,
    "mxHealth": 0,
    "mxPersistent": 0
  },
  "dnsSize": 45,
  "resultSize": 12
}
```

**Response `200` — SQLite backend**

```json
{ "backend": "sqlite" }
```

### 7.9 `POST /v1/cache/clear`

**Request body (optional)** — default `{ "type": "all" }`.

**`type` values:** `all`, `result`, `dns`, `mx`, `domain`, `dead`, `disposable`, `role`, `catchall`, `provider_cooldown`, `mx_health`, `mx_persistent`.

**Example**

```json
{ "type": "result" }
```

**Response `200`**

```json
{ "ok": true, "cleared": "result" }
```

### 7.10 `GET /v1/cooldown`

**Response `200`**

```json
{
  "providers": {
    "gmail": {
      "untilIso": "2026-01-01T12:00:00.000Z",
      "lastSmtpAtIso": "2026-01-01T11:00:00.000Z",
      "blockCount": 2,
      "active": true
    }
  }
}
```

(Empty or partial objects when no state.)

### 7.11 `POST /v1/cooldown/reset`

**Request body (optional)**

- **`{}`** or omitted body — clears **all** provider cooldown state.  
- **`{ "provider": "gmail" }`** — clears only that provider id (`gmail`, `outlook`, `yahoo`, …, or `other`).

```json
{ "provider": "gmail" }
```

**Response `200`**

```json
{ "ok": true }
```

### 7.12 Rate limiting and HTTP status codes

- **429** — global rate limit (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`) when tripped.  
- **401** — missing / wrong Bearer when auth is required.  
- **403** — IP not allowlisted, or HMAC / policy failure.  
- **409** — HMAC replay (`X-Request-Id` reuse).  
- **413** — body too large (`REQUEST_BODY_MAX_BYTES`).  
- **500** — unexpected server error; in `NODE_ENV=production`, body is often `{ "error": "internal_error" }`.

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

**Score and deliverability** are **omitted** for intentionally inconclusive rows (e.g. many `retry_later` / `greylisted` cases); see [scoring.service.ts](src/services/scoring.service.ts).

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
| `npm run build` | Bundle to [dist/server.js](dist/server.js) (tsup) |
| `npm start` | `node dist/server.js` |
| `npm test` | Vitest (deterministic; no live network by default) |
| `LIVE_NETWORK=1 npm test` | Opt-in real DNS integration test (needs network) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

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

---

## 14. Contributing and support

- **Author:** Abdus Samad — [abdsmd@gmail.com](mailto:abdsmd@gmail.com)  
- Issues, forks, and pull requests are welcome for this public project.  
- For deployment detail beyond this README, use **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** and **[install-ubuntu-22.04.sh](install-ubuntu-22.04.sh)**.

---

*VerificationStation — MIT License. Copyright (c) 2026 Abdus Samad.*
