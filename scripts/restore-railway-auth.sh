#!/usr/bin/env bash
# Restores Railway CLI authentication from env vars persisted in Vercel.
# Requires RAILWAY_TOKEN (a long-lived account API token from
# https://railway.com/account/tokens) stored as a Vercel env var.
#
# Usage: bash scripts/restore-railway-auth.sh
# The init skill sources this automatically on /init.

set -euo pipefail

ENV_FILE="/vercel/share/.env.project"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${RAILWAY_TOKEN:-}" ]; then
  echo "[railway-auth] ERROR: RAILWAY_TOKEN is not set." >&2
  echo "[railway-auth] Create one at https://railway.com/account/tokens" >&2
  echo "[railway-auth] then add it as RAILWAY_TOKEN in your Vercel project env vars." >&2
  exit 1
fi

# Railway CLI v5 reads RAILWAY_TOKEN from the environment directly — no config
# file needed. Export it so every subsequent railway command in this shell uses it.
export RAILWAY_TOKEN

result=$(RAILWAY_TOKEN="$RAILWAY_TOKEN" railway whoami 2>&1 | grep -v "parse config" | head -1)
if [ -z "$result" ]; then
  echo "[railway-auth] ERROR: railway whoami returned no output — token may be invalid." >&2
  exit 1
fi
echo "[railway-auth] Authenticated as: $result"
