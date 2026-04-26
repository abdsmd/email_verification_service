# VerificationStation

**VerificationStation** is a production-oriented **Node.js (Fastify) HTTP service** for **email address verification**: syntax, DNS/MX resolution, policy signals (disposable/role), optional catch-all probes, and **real** SMTP `RCPT TO` probing. It is designed to run on a **VPS** and be called by your control plane or app.

| | |
|---|--|
| **Repository** | **[github.com/abdsmd/email_verification_service](https://github.com/abdsmd/email_verification_service)** |
| **Stack** | Node.js ≥ 22, Fastify 5, TypeScript, Zod, pino, PM2 |
| **Real network I/O** | Uses Node’s **`dns/promises`** and **`net` TCP** to MX hosts (no fake / simulated SMTP) |
| **Docs (deploy)** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Ubuntu 22.04, Nginx, UFW, upgrades |
| **Docker** | [docs/DOCKER.md](docs/DOCKER.md) — [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml), data on host `./data` |
| **One-shot install** | [install-ubuntu-22.04.sh](install-ubuntu-22.04.sh) in the **repository root** (clone from GitHub, then run the script; see [§5](#5-production-step-by-step-ubuntu-2204)) |

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
| [src/routes/](src/routes/) | HTTP handlers (`verify`, `batch`, `health`, `cache`, `metrics`, `cooldown`) |
| [src/services/](src/services/) | Verification pipeline, DNS/MX, SMTP, cache, scoring, provider cooldown |
| [src/middleware/](src/middleware/) | Auth, HMAC, rate limit, error / not-found JSON |
| [src/config/](src/config/) | Environment schema, aliases, public routes |
| [tests/](tests/) | Vitest unit and contract tests |

**Making the GitHub (or GitLab) repository public**

1. Push this project to a remote: `git remote add origin https://github.com/abdsmd/email_verification_service.git` then `git push -u origin main` (if the remote is not set yet).
2. On GitHub: **Settings → General → Danger zone → Change repository visibility → Public**.
3. Do **not** commit secrets. Use `.env` on the server only (or your secret store). See [.env.example](.env.example).

---

## Table of contents

1. [Features](#1-features)  
2. [What this service does *not* do](#2-what-this-service-does-not-do)  
3. [Requirements](#3-requirements)  
4. [Quick start (local development)](#4-quick-start-local-development)  
   - [4.1 Docker](#41-docker)  
5. [Production: step-by-step (Ubuntu 22.04)](#5-production-step-by-step-ubuntu-2204)  
6. [Configuration (environment)](#6-configuration-environment)  
7. [HTTP API](#7-http-api)  
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
- **PWA** (optional): installable web shell at `/` — `manifest.webmanifest`, service worker, health and verify helpers; set `PWA_ENABLED=false` for API-only.  
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

Set at least **`STATION_SECRET`** (or `API_KEY`), **`HELO_DOMAIN`**, **`MAIL_FROM`** (or `MAIL_FROM_DOMAIN`), and tune concurrency. Save and exit.

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
| `LOG_FULL_EMAIL` | Default `false` — redact addresses in error logs; set `true` only for debugging |

Ops-style **aliases** (e.g. `API_PORT` → `PORT`) are in [src/config/env-aliases.ts](src/config/env-aliases.ts). A production-oriented sample: [env.production.example](env.production.example).

---

## 7. HTTP API

**One-page reference (routes, auth, bodies, errors):** [docs/API.md](docs/API.md)

**Postman:** Import [postman/VerificationStation.postman_collection.json](postman/VerificationStation.postman_collection.json) (**File → Import** in Postman). Set collection variables **`baseUrl`** (e.g. `http://127.0.0.1:8090`) and **`bearerToken`** when `STATION_SECRET` or `API_KEY` is set. Folders: **Public** (health, ready, metrics) and **Protected** (verify, batch, cache, cooldown).

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
- **Managed service:** same contact if you want this stack run for you; see the note under [Author & open source](#author--open-source) above.  
- Issues, forks, and pull requests are welcome for this public project.  
- For deployment detail beyond this README, use **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** and **[install-ubuntu-22.04.sh](install-ubuntu-22.04.sh)**.

---

*VerificationStation — MIT License. Copyright (c) 2026 Abdus Samad.*
