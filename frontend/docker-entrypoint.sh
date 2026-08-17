#!/bin/sh
set -eu

export BACKEND_URL="${BACKEND_URL:-https://smartedge-api.fly.dev}"
# strip trailing slash
BACKEND_URL="$(echo "$BACKEND_URL" | sed 's:/*$::')"
export BACKEND_URL

echo "[smartedge-web] BACKEND_URL=${BACKEND_URL}"
echo "[smartedge-web] binding 0.0.0.0:8080"

TEMPLATE="/etc/nginx/nginx.conf.template"
TARGET="/etc/nginx/conf.d/default.conf"

if [ -f "$TEMPLATE" ]; then
  # Only substitute BACKEND_URL; leave nginx $vars alone
  envsubst '${BACKEND_URL}' < "$TEMPLATE" > "$TARGET"
  echo "[smartedge-web] wrote proxy config"
else
  echo "[smartedge-web] WARNING: template missing, using static conf"
fi

# Validate config before start
nginx -t

echo "[smartedge-web] starting nginx"
exec nginx -g "daemon off;"
