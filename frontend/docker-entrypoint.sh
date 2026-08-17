#!/bin/sh
set -eu

export BACKEND_URL="${BACKEND_URL:-https://smartedge-api.fly.dev}"
BACKEND_URL="$(echo "$BACKEND_URL" | sed 's:/*$::')"
export BACKEND_URL

echo "[smartedge-web] BACKEND_URL=${BACKEND_URL}"
echo "[smartedge-web] binding 0.0.0.0:8080"

TEMPLATE="/etc/nginx/nginx.conf.template"
TARGET="/etc/nginx/conf.d/default.conf"

if [ -f "$TEMPLATE" ]; then
  envsubst '${BACKEND_URL}' < "$TEMPLATE" > "$TARGET"
  echo "[smartedge-web] wrote proxy config (runtime DNS)"
else
  echo "[smartedge-web] WARNING: template missing — static only"
fi

if ! nginx -t; then
  echo "[smartedge-web] proxy config invalid — falling back to static SPA"
  cp /etc/nginx/nginx.static.conf "$TARGET" 2>/dev/null || true
  # if we baked static as default.conf already, rewrite pure static
  cat > "$TARGET" << 'STATIC'
server {
    listen 0.0.0.0:8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
STATIC
  nginx -t
fi

echo "[smartedge-web] starting nginx"
exec nginx -g "daemon off;"
