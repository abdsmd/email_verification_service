#!/usr/bin/env bash
# =============================================================================
# VerificationStation — Ubuntu 22.04 LTS (Jammy) bootstrap
# =============================================================================
# Run with sudo-capable user (not necessarily root):
#   chmod +x install-ubuntu-22.04.sh
#   export GIT_REPO="https://github.com/your-org/your-fork.git"   # or leave empty if files already in APP_DIR
#   export NGINX_SERVER_NAME="verify.example.com"                 # optional
#   export SETUP_NGINX=1   # 1 to install Nginx site stub + remind certbot
#   export SETUP_UFW=1     # 1 to enable UFW (SSH + 80 + 443)
#   ./install-ubuntu-22.04.sh
#
# Defaults: APP_DIR=/opt/verification-station, DEPLOY_USER=verification, APP_PORT=8080
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log() { echo -e "${GREEN}[install]${NC} $*"; }
warn() { echo -e "${YELLOW}[install]${NC} $*"; }
err() { echo -e "${RED}[error]${NC} $*" >&2; }

# --- 0) Target OS ------------------------------------------------------------
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
    err "This script targets Ubuntu 22.04. Found: ${ID:-?} ${VERSION_ID:-?}"
    read -r -p "Continue anyway? [y/N] " c || true
    [[ "${c:-}" =~ ^[yY]$ ]] || exit 1
  fi
fi

export DEBIAN_FRONTEND=noninteractive

# --- 1) OS updates (security + dependency fixes) -----------------------------
# update: fresh package index. full-upgrade: install newest versions + resolve new deps.
# autoremove: drop packages no longer required after upgrade.
log "apt-get update && full-upgrade (this can take a few minutes)…"
sudo apt-get update -y
sudo apt-get -y full-upgrade
sudo apt-get -y autoremove

# curl/gnupg/ca-certificates: NodeSource; build-essential/python3: node-gyp / better-sqlite3
# git: clone; nginx/certbot: optional edge TLS; ufw: firewall
log "Installing base packages…"
sudo apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  git \
  rsync \
  build-essential \
  python3 \
  ufw \
  nginx \
  certbot \
  python3-certbot-nginx

# NTP: most clouds already run chrony/timesync; ensure NTP is on if available
if command -v timedatectl &>/dev/null; then
  sudo timedatectl set-ntp true 2>/dev/null || true
fi

# --- 2) Node.js 22 (NodeSource) -----------------------------------------------
# See: https://github.com/nodesource/distributions
if ! command -v node &>/dev/null || [[ "$(node -v 2>/dev/null || true)" != v22* ]]; then
  log "Installing Node.js 22.x from NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
log "Using: $(command -v node) $(node -v)  $(command -v npm) $(npm -v)"

# --- 3) Service account and paths --------------------------------------------
DEPLOY_USER="${DEPLOY_USER:-verification}"
APP_DIR="${APP_DIR:-/opt/verification-station}"
APP_PORT="${APP_PORT:-8080}"
LOG_DIR="/var/log/verification-station"
DATA_DIR="${DATA_DIR:-/var/lib/verification-station/data}"
GIT_REPO="${GIT_REPO:-}"

# Create empty APP_DIR first, then a user with that home but no skeleton (-M) so
# `git clone` into APP_DIR is not blocked by default dotfiles in a "filled" home.
sudo mkdir -p "${APP_DIR}"
if ! id -u "${DEPLOY_USER}" &>/dev/null; then
  log "Creating user ${DEPLOY_USER} (home ${APP_DIR})…"
  # -M: do not copy /etc/skel (keeps tree empty for git)
  # -U: private group; -r: system UID; -d: login home
  sudo useradd -r -M -U -d "${APP_DIR}" -s /bin/bash "${DEPLOY_USER}" || {
    err "useradd failed; create ${DEPLOY_USER} manually and re-run"
    exit 1
  }
fi
sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"

sudo mkdir -p "${LOG_DIR}" "${DATA_DIR}"
# PM2 (see ecosystem.config.js) writes to /var/log/verification-station — must be writable by app user
sudo chown "${DEPLOY_USER}:${DEPLOY_USER}" "${LOG_DIR}"
sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DATA_DIR}"

# --- 4) Application tree ------------------------------------------------------
if [[ -n "${GIT_REPO}" ]]; then
  if [[ ! -d "${APP_DIR}/.git" ]]; then
    if [[ -n "$(ls -A "${APP_DIR}" 2>/dev/null || true)" ]]; then
      err "${APP_DIR} is not empty and has no .git. Move it aside or use an empty path."
      exit 1
    fi
    log "Cloning ${GIT_REPO} → ${APP_DIR}…"
    sudo -u "${DEPLOY_USER}" git clone --depth=1 "${GIT_REPO}" "${APP_DIR}"
  else
    log "Repository already at ${APP_DIR}; skip clone."
  fi
else
  if [[ ! -f "${APP_DIR}/package.json" ]]; then
    err "Set GIT_REPO to clone, or copy the project to ${APP_DIR} first, then re-run."
    exit 1
  fi
fi

# --- 5) Install deps and build -----------------------------------------------
log "npm ci, test, and build (as ${DEPLOY_USER})…"
sudo -i -u "${DEPLOY_USER}" bash <<EOS
set -euo pipefail
cd "${APP_DIR}"
npm ci
npm run typecheck
npm run test
npm run build
EOS

# --- 6) Environment -----------------------------------------------------------
if [[ ! -f "${APP_DIR}/.env" && -f "${APP_DIR}/.env.example" ]]; then
  warn "Copying .env from .env.example — you must set secrets and HELO/MAIL before production."
  sudo -u "${DEPLOY_USER}" cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
fi

# Suggested production defaults: append a line only if that key is not already set
# You must still edit secrets: STATION_SECRET, HELO_DOMAIN, MAIL_FROM, etc.
if [[ -f "${APP_DIR}/.env" ]]; then
  sudo -i -u "${DEPLOY_USER}" bash -c "
    set -e
    f='${APP_DIR}/.env'
    grep -qE '^HOST=' \"\$f\" 2>/dev/null || echo 'HOST=127.0.0.1' >> \"\$f\"
    grep -qE '^PORT=' \"\$f\" 2>/dev/null || echo 'PORT=${APP_PORT}' >> \"\$f\"
    grep -qE '^TRUST_PROXY=' \"\$f\" 2>/dev/null || echo 'TRUST_PROXY=true' >> \"\$f\"
    grep -qE '^NODE_ENV=' \"\$f\" 2>/dev/null || echo 'NODE_ENV=production' >> \"\$f\"
  "
fi

# --- 7) PM2 -------------------------------------------------------------------
log "Installing PM2 globally (npm)…"
sudo npm install -g pm2@latest

sudo -i -u "${DEPLOY_USER}" bash <<EOS
set -euo pipefail
cd "${APP_DIR}"
if pm2 describe verification-station &>/dev/null; then
  pm2 reload ecosystem.config.js
else
  pm2 start ecosystem.config.js
fi
pm2 save
EOS

# Prints a one-liner to register systemd — run it once as instructed
log "PM2 on boot: run the sudo command this prints once (saves the systemd unit):"
if sudo -i -u "${DEPLOY_USER}" bash -c "cd '${APP_DIR}' && pm2 startup systemd" 2>&1 | tee /tmp/pm2-startup-instructions.txt; then
  : # startup prints instructions for root to run
else
  warn "pm2 startup failed; see /tmp/pm2-startup-instructions.txt and README."
fi

# --- 8) Nginx (optional) ------------------------------------------------------
SETUP_NGINX="${SETUP_NGINX:-0}"
NGINX_SERVER_NAME="${NGINX_SERVER_NAME:-}"
if [[ "${SETUP_NGINX}" == "1" && -n "${NGINX_SERVER_NAME}" ]]; then
  log "Nginx: reverse proxy to 127.0.0.1:${APP_PORT}…"
  NGINX_FILE="/etc/nginx/sites-available/verification-station"
  sudo tee "${NGINX_FILE}" > /dev/null <<EOF
upstream verification_station {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${NGINX_SERVER_NAME};

    client_max_body_size 2m;

    location / {
        proxy_pass http://verification_station;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  sudo ln -sf "${NGINX_FILE}" /etc/nginx/sites-enabled/verification-station
  sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  sudo nginx -t
  sudo systemctl reload nginx
  log "When DNS A/AAAA for ${NGINX_SERVER_NAME} points to this host, get TLS with:"
  log "  sudo certbot --nginx -d ${NGINX_SERVER_NAME}"
else
  log "Skipping Nginx (set SETUP_NGINX=1 and NGINX_SERVER_NAME)."
fi

# --- 9) UFW (optional) --------------------------------------------------------
if [[ "${SETUP_UFW:-0}" == "1" ]]; then
  log "UFW: allow SSH, HTTP, HTTPS…"
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  # Do not expose APP_PORT publicly when Nginx terminates TLS
  echo "y" | sudo ufw enable || true
  sudo ufw status verbose
else
  log "Skipping UFW (set SETUP_UFW=1 to enable)."
fi

log "Smoke test (local): curl -sS http://127.0.0.1:${APP_PORT}/health"
log "Next: edit ${APP_DIR}/.env (STATION_SECRET, HELO_DOMAIN, MAIL_FROM, rates)."

exit 0
