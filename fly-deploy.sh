#!/usr/bin/env bash
# Deploy SmartEdge to Fly.io (API + Web)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
API_APP="${API_APP:-smartedge-api}"
WEB_APP="${WEB_APP:-smartedge-web}"
REGION="${REGION:-lhr}"

echo "==> Checking flyctl"
command -v fly >/dev/null || { echo "Install flyctl: https://fly.io/docs/hands-on/install-flyctl/"; exit 1; }

echo "==> Backend app: $API_APP"
cd "$ROOT/backend"
if ! fly status -a "$API_APP" >/dev/null 2>&1; then
  fly apps create "$API_APP" --org personal 2>/dev/null || true
fi
# Secrets (skip if already set)
if [ -n "${BYBIT_API_KEY:-}" ] && [ -n "${BYBIT_API_SECRET:-}" ]; then
  fly secrets set \
    BYBIT_API_KEY="$BYBIT_API_KEY" \
    BYBIT_API_SECRET="$BYBIT_API_SECRET" \
    SELF_URL="https://${API_APP}.fly.dev" \
    -a "$API_APP"
fi
fly deploy -a "$API_APP" --region "$REGION"

API_URL="https://${API_APP}.fly.dev"
echo "==> Frontend app: $WEB_APP  (VITE_API_URL=$API_URL)"
cd "$ROOT/frontend"
if ! fly status -a "$WEB_APP" >/dev/null 2>&1; then
  fly apps create "$WEB_APP" --org personal 2>/dev/null || true
fi
fly deploy -a "$WEB_APP" --region "$REGION" --build-arg "VITE_API_URL=$API_URL"

echo ""
echo "Done."
echo "  API:  $API_URL"
echo "  Web:  https://${WEB_APP}.fly.dev"
echo "  Health: $API_URL/health"
