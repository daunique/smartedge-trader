#!/bin/sh
set -e
# Replace BACKEND_UPSTREAM placeholder with runtime BACKEND_URL (no trailing slash)
BACKEND="${BACKEND_URL:-https://smartedge-api.fly.dev}"
BACKEND=$(echo "$BACKEND" | sed 's:/*$::')
sed "s|BACKEND_UPSTREAM|${BACKEND}|g" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
# Ensure listen port
sed -i "s/listen 8080/listen ${PORT:-8080}/" /etc/nginx/conf.d/default.conf
echo "[smartedge-web] proxying /api /ws /health → ${BACKEND}"
exec nginx -g 'daemon off;'
