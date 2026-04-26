#!/bin/sh
# Seed /app/data from baked-in defaults when a bind mount is empty, then drop privileges.
set -e
mkdir -p /app/data
if [ -d /app/data.defaults ]; then
  for f in /app/data.defaults/*; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    if [ ! -f "/app/data/$b" ]; then
      cp "$f" "/app/data/$b"
    fi
  done
fi
# SQLite and caches need write access as node; bind mounts are often root-owned on Linux hosts.
if [ "$(id -u)" = 0 ] && [ "${SKIP_CHOWN_DATA:-0}" != "1" ]; then
  chown -R node:node /app/data
  exec gosu node "$@"
fi
exec "$@"
