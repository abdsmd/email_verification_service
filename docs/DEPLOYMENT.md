# VerificationStation — deployment on Ubuntu 22.04 LTS

This guide targets a **fresh Ubuntu Server 22.04 (Jammy)** instance. The app must be able to reach the internet for **DNS (53)** and **SMTP (25)** from this host (typical for a small VPS).

- **HTTP API, sample requests/responses, auth:** root [README.md](../README.md) (public, end-user and integrator focus).  
- **Environment variable reference:** [README.md §6 Configuration](../README.md#6-configuration-environment) and [.env.example](../.env.example).  
- **Docker (Compose, host-mounted data, SQLite):** [DOCKER.md](DOCKER.md).

---

## 1. What you will install

| Layer | Purpose |
|-------|---------|
| **OS updates** | Security patches and consistent package base (`apt update` / `full-upgrade`). |
| **Node.js 22** | Runtime required by `package.json` (`engines.node >= 22`). Installed from **NodeSource** (same major for all machines). |
| **Build toolchain** | `build-essential`, `python3` — needed to compile **better-sqlite3** during `npm ci`. |
| **Application user** | Non-root user (default `verification`) owns code, PM2 home, and writable data directory. |
| **PM2** | Keeps `node dist/server.js` running, restarts on crash, optional boot persistence via **systemd**. |
| **Nginx** (optional) | TLS termination and reverse proxy to `127.0.0.1:PORT`. |
| **UFW** (optional) | Host firewall: SSH + HTTP + HTTPS; app port stays on loopback only when using Nginx. |

---

## 2. Network and DNS expectations

- **Inbound:** SSH (22), and if using Nginx + Let’s Encrypt: HTTP (80) and HTTPS (443). The app should listen on **127.0.0.1** in production so it is not exposed directly.
- **Outbound:** **TCP 25** to remote MX servers, **UDP/TCP 53** for DNS resolvers, **HTTPS 443** for `apt` / `certbot` / NodeSource.
- **DNS for your public hostname:** point your API hostname (e.g. `verify-api.example.com`) **A/AAAA** record to the server **before** running `certbot`.

---

## 3. One-shot automated install (shell script)

The repository includes a commented installer:

| Path | Role |
|------|------|
| [`install-ubuntu-22.04.sh`](../install-ubuntu-22.04.sh) (repo root) | **Ubuntu 22.04** — apt refresh, Node 22, user + dirs, `npm ci` / `build` / `test`, PM2, optional Nginx + UFW. |

**Preparation**

1. Create a **sudo-capable** user (or use the default `ubuntu` cloud user) and SSH into the server.
2. Either **clone** this repo *or* upload a tarball; the script expects the app (or a `GIT_REPO` URL) under `/opt/verification-station` by default.

**Example: clone and run (recommended)**

```bash
# 1) OS updates and git (if you have not run the full script yet)
sudo apt-get update
sudo apt-get -y full-upgrade
sudo apt-get -y install git
sudo apt-get -y autoremove

# 2) Get the project (replace with your fork or internal URL)
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
cd /opt
git clone <YOUR-REPO-URL> verification-station
cd verification-station

# 3) Make the script executable and run (edit exports as needed)
chmod +x install-ubuntu-22.04.sh

# Optional exports before running:
#   GIT_REPO=...       # only if the tree is not already under /opt/verification-station
#   APP_DIR=...        # default /opt/verification-station
#   DEPLOY_USER=...    # default verification
#   APP_PORT=8090
#   SETUP_NGINX=1
#   NGINX_SERVER_NAME=verify-api.example.com
#   SETUP_UFW=1

export SETUP_NGINX=0
export SETUP_UFW=0
sudo ./install-ubuntu-22.04.sh
```

**What the script does (summary)**

- Runs `apt-get update`, `full-upgrade`, `autoremove` so the base system matches current security updates.
- Installs `curl`, `gnupg`, `ca-certificates`, `build-essential`, `python3`, `git`, `rsync`, `nginx`, `certbot`, `ufw` (as needed for later steps).
- Installs **Node.js 22** via the official NodeSource `setup_22.x` script, then `nodejs` from apt.
- Creates user `verification` (or `DEPLOY_USER`) with home under `APP_DIR`, creates `/var/log/verification-station` for PM2 logs, `/var/lib/verification-station/data` for optional SQLite.
- Runs `npm ci`, `npm run typecheck`, `npm run test`, `npm run build` as the deploy user.
- Copies `.env` from `.env.example` if `.env` is missing, then appends `HOST`, `PORT`, `TRUST_PROXY`, `NODE_ENV` only if those keys are **not** already in `.env`.
- Installs **PM2** globally, starts [ecosystem.config.js](../ecosystem.config.js), runs `pm2 save`, prints **`pm2 startup`** instructions (you run the printed `sudo ...` line **once** to enable restart on boot).
- Optionally writes an **Nginx** site and can enable **UFW** (see environment variables in the script header).

**After the script**

1. Edit `/opt/verification-station/.env` (or your `APP_DIR`): **STATION_SECRET** (or **API_KEY**), **HELO_DOMAIN**, **MAIL_FROM**, and tuning variables from the README.
2. Re-read PM2 on-disk instructions if boot persistence was not completed: `sudo -iu verification cat /tmp/pm2-startup-instructions.txt` (path may differ).
3. Smoke test: `curl -sS http://127.0.0.1:8090/health` (use your `PORT` if changed).

---

## 4. Manual step-by-step (same as the script, with comments)

Use this if you need to **understand** each step or to **debug** a failed automation run.

### 4.1 Point release upgrades and base packages

```bash
# Non-interactive apt (safe for scripts / SSH)
export DEBIAN_FRONTEND=noninteractive

# Refresh package index from configured mirrors
sudo apt-get update -y

# Install newest package versions; may pull new dependencies
sudo apt-get -y full-upgrade

# Remove packages that are no longer required (keeps disk and dependency graph clean)
sudo apt-get -y autoremove
```

**Optional — unattended security updates (recommended on servers):**

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 4.2 Packages required to build the app and run the edge

```bash
sudo apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  git \
  rsync \
  build-essential \
  python3 \
  nginx \
  certbot \
  python3-certbot-nginx \
  ufw
```

- **build-essential** / **python3**: needed when `npm ci` compiles `better-sqlite3`.
- **nginx** / **certbot**: only if you terminate TLS on this host; otherwise you can install them later.

### 4.3 Install Node.js 22.x (NodeSource)

Do **not** rely on the Ubuntu default `nodejs` package if it is older than 22. Use NodeSource (see [NodeSource distributions](https://github.com/nodesource/distributions)):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

You should see **v22.x** and a matching `npm` version.

### 4.4 Create deploy user, directories, and log path

[ecosystem.config.js](../ecosystem.config.js) writes logs to `/var/log/verification-station/`. The deploy user must own that directory (or you change paths in the ecosystem file).

Create the app root **empty** first, then the user with **`-M`** (no copy of `/etc/skel` into home) so a later `git clone` into `/opt/verification-station` does not see a “non-empty” directory:

```bash
sudo mkdir -p /opt/verification-station
sudo useradd -r -M -U -d /opt/verification-station -s /bin/bash verification
sudo chown -R verification:verification /opt/verification-station
sudo mkdir -p /var/log/verification-station
sudo chown verification:verification /var/log/verification-station
sudo mkdir -p /var/lib/verification-station/data
sudo chown -R verification:verification /var/lib/verification-station
```

### 4.5 Place the application and build

```bash
sudo -iu verification
cd /opt/verification-station
# (populate from git or rsync: project root with package.json)
npm ci
npm run typecheck
npm run test
npm run build
cp -n .env.example .env
nano .env   # set STATION_SECRET, HELO_DOMAIN, MAIL_FROM, etc.
```

Production-oriented defaults in `.env` (adjust as needed):

```bash
HOST=127.0.0.1
PORT=8090
NODE_ENV=production
TRUST_PROXY=true
# If using SQLite on disk (optional):
# CACHE_BACKEND=sqlite
# SQLITE_PATH=/var/lib/verification-station/data/cache.sqlite
```

### 4.6 Install PM2 and start the app

```bash
# As root or with sudo: global PM2
sudo npm install -g pm2@latest

# As user verification, from the app directory
sudo -iu verification
cd /opt/verification-station
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd
# Run the one-line "sudo env PATH=... pm2 ..." command that the previous command prints
```

### 4.7 Nginx reverse proxy (optional)

A minimal example (replace `verify-api.example.com`):

```nginx
upstream verification_station {
    server 127.0.0.1:8090;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name verify-api.example.com;

    client_max_body_size 2m;

    location / {
        proxy_pass http://verification_station;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
# When DNS is correct:
# sudo certbot --nginx -d verify-api.example.com
```

Set **`TRUST_PROXY=true`** in the app when using Nginx and `X-Forwarded-*` headers (README §4).

### 4.8 Host firewall (UFW) (optional)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Do not open 8090 publicly if the app is bound to 127.0.0.1 and only Nginx connects
echo "y" | sudo ufw enable
sudo ufw status verbose
```

**Outbound** SMTP (25) and DNS (53) are allowed by UFW’s default `allow outgoing` — do not block those if verification must reach the internet.

---

## 5. Upgrading the OS and the application

**Ubuntu security updates (ongoing):**

```bash
sudo apt-get update
sudo apt-get -y full-upgrade
sudo apt-get -y autoremove
# If kernel updated, reboot in a maintenance window
# sudo reboot
```

**Application update:**

```bash
sudo -iu verification
cd /opt/verification-station
git pull
npm ci
npm run test
npm run build
pm2 reload ecosystem.config.js
```

---

## 6. Smoke tests and health checks

```bash
curl -sS http://127.0.0.1:8090/health
curl -sS http://127.0.0.1:8090/v1/ready
# With auth set:
curl -sS -H "Authorization: Bearer $STATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","options":{}}' \
  http://127.0.0.1:8090/v1/verify
```

If TLS is in front: use `https://verify-api.example.com/...` and ensure DNS points to the server.

---

## 7. Common Ubuntu / Node / native module issues

| Symptom | What to do |
|--------|------------|
| `better-sqlite3` compile errors during `npm ci` | Install `build-essential` and `python3`; re-run `npm ci`. |
| `node: not v22` | Re-run the NodeSource `setup_22.x` block and `apt-get install -y nodejs`. |
| PM2 not surviving reboot | Re-run `pm2 save` and the **exact** `sudo env ...` line from `pm2 startup` as **root**. |
| `EADDRINUSE` on `PORT` | `sudo ss -tlnp \| grep 8090` (or your port) and stop the conflicting process. |
| All verifications time out or fail DNS | Check outbound **53** and **25** (provider security groups + local `ufw status`). |
| 502 from Nginx | App not running (`pm2 status`), wrong `upstream` port, or `HOST` not `127.0.0.1` / mismatch. |

---

## 8. File reference

| Artifact | Description |
|----------|-------------|
| [ecosystem.config.js](../ecosystem.config.js) | PM2: name `verification-station`, `dist/server.js`, 512M max memory, log paths under `/var/log/verification-station/`. |
| [install-ubuntu-22.04.sh](../install-ubuntu-22.04.sh) | Ubuntu 22.04 one-shot bootstrap (root of the repo). |
| [.env.example](../.env.example) | Template for production `.env` (see README for every variable). |
| [docs/DEPLOYMENT.md](DEPLOYMENT.md) | This file. |

For troubleshooting specific API errors, see **README §15** (Troubleshooting).
