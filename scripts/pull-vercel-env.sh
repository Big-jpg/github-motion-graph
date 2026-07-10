#!/usr/bin/env bash
set -euo pipefail

# scripts/pull-vercel-env.sh
# Pull production env vars from Vercel into a local .env file for testing.
# Requirements:
#   - Install Vercel CLI: `npm i -g vercel` or use `npx vercel`.
#   - Export a non-sensitive token in the environment or rely on interactive login.
#     Prefer: export VERCEL_TOKEN=your_token
#   - (Optional) Set VERCEL_PROJECT or VERCEL_ORG if you need to target a specific project.
# Usage:
#   VERCEL_TOKEN=xxx ./scripts/pull-vercel-env.sh
#   or
#   ./scripts/pull-vercel-env.sh --project my-project --env production

TARGET_FILE=".env.local"
ENVIRONMENT="production"
PROJECT=""
TOKEN="${VERCEL_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT="$2"; shift 2 ;;
    --env) ENVIRONMENT="$2"; shift 2 ;;
    --out) TARGET_FILE="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    -h|--help) echo "Usage: $0 [--project <project>] [--env <production|preview|development>] [--out <file>]"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 2 ;;
  esac
done

if ! command -v vercel >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "Vercel CLI not found. Install it: npm i -g vercel (or use npx vercel)" >&2
  exit 2
fi

CMD_ARGS=(env pull "$TARGET_FILE" --environment "$ENVIRONMENT")
if [ -n "$PROJECT" ]; then
  CMD_ARGS+=(--project "$PROJECT")
fi
if [ -n "$TOKEN" ]; then
  CMD_ARGS+=(--token "$TOKEN")
fi

echo "Pulling Vercel env vars ($ENVIRONMENT) into $TARGET_FILE"
if command -v vercel >/dev/null 2>&1; then
  vercel "${CMD_ARGS[@]/#/}" || { echo "vercel env pull failed"; exit 1; }
else
  # use npx vercel
  npx vercel "${CMD_ARGS[@]/#/}" || { echo "npx vercel env pull failed"; exit 1; }
fi

echo "Done. $TARGET_FILE created. (Ensure this file is ignored by git)"
