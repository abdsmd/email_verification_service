# Docker

Run Verification Station in a container with **cache and SQLite on the host** (bind mount), so data survives image rebuilds and restarts.

## Files

| File | Role |
|------|------|
| [Dockerfile](../Dockerfile) | Multi-stage build (compiles `better-sqlite3`), runs as `node` after entrypoint |
| [docker-compose.yml](../docker-compose.yml) | Service, `./data` → `/app/data`, env from `.env` |
| [docker/entrypoint.sh](../docker/entrypoint.sh) | Seeds default list/JSON into `/app/data` if missing; `chown` for `node` user |
| [docker/.env.example](../docker/.env.example) | Template for root `.env` when using Compose |

## Quick start

```bash
cp docker/.env.example .env
# Edit .env — at least STATION_SECRET, HELO_DOMAIN, MAIL_FROM (or MAIL_FROM_DOMAIN)

docker compose up -d --build
curl -sS http://127.0.0.1:8090/health
```

Default port: **8090** (override `PORT` in `.env`; compose maps the same value host → container).

## Data on the host

- **Host path:** `./data` (repository root, next to `docker-compose.yml`).
- **Container path:** `/app/data`.
- **Contents:** `verification-station.db` (SQLite cache + optional provider cooldown rows), seeded `disposable-domains.txt`, `role-prefixes.txt`, `known-providers.json`, and any extra files you add (e.g. `extra-disposable.txt` via `DISPOSABLE_LIST_PATH`).

**PWA:** The image includes the `public/` PWA (manifest, service worker, local verify UI) at the same origin. Set `PWA_ENABLED=false` in the environment to disable static hosting and use the process as API-only.

**HOST in Docker:** Compose sets `HOST=0.0.0.0` because binding only to `127.0.0.1` inside a container **breaks** `ports:` forwarding on the default bridge network. Security is: do not publish the port publicly, or use a host firewall; bare-metal installs should use `127.0.0.1` and Nginx.

Compose sets `CACHE_BACKEND=sqlite`, `SQLITE_PATH=/app/data/verification-station.db`, and `PROVIDER_COOLDOWN_PERSIST=true` so behaviour is **stable across restarts** with data on disk.

## Operations

```bash
docker compose logs -f verification-station
docker compose pull   # only if you use a registry image; for local build use --build
docker compose down
```

## Networking

The service needs **outbound TCP 25** (SMTP to MX) and **DNS** from inside the container (same as bare metal). Publish only the HTTP port you need; put TLS and auth in front with a reverse proxy in production.

## Permissions

The entrypoint runs as **root** briefly to `chown` `/app/data` for user `node`, then starts the app as **node** (uid 1000). If your host directory is NFS or you manage ownership yourself, set `SKIP_CHOWN_DATA=1` in the `environment` section of `docker-compose.yml` and ensure `/app/data` is writable by uid **1000**.

## Build without Compose

```bash
docker build -t verification-station:local .
docker run --rm -p 8090:8090 \
  -v "$(pwd)/data:/app/data" \
  --env-file .env \
  -e DATA_DIR=data \
  -e CACHE_BACKEND=sqlite \
  -e SQLITE_PATH=/app/data/verification-station.db \
  -e PROVIDER_COOLDOWN_PERSIST=true \
  verification-station:local
```

Pass the same `STATION_SECRET` and mail identity variables as in `.env`.
