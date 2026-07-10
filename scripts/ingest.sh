#!/usr/bin/env bash
set -euo pipefail

# scripts/ingest.sh
# Usage:
#   INGEST_SECRET=shh GH_TOKEN=ghp_xxx ./scripts/ingest.sh Big-jpg
# Optional environment variables:
#   INGEST_URL - override the ingest endpoint (default: https://github-motion-graph.vercel.app/api/ingest)
# Notes:
# - The endpoint expects the ingest secret in the Authorization header (Bearer <INGEST_SECRET>).
# - The server uses GH_TOKEN (server-side) to call GitHub; you don't need to send GH_TOKEN to the endpoint.

URL="${INGEST_URL:-https://github-motion-graph.vercel.app/api/ingest}"
USERNAME="${1:-}"
INGEST_SECRET="${INGEST_SECRET:-}"

if [ -z "$USERNAME" ]; then
  echo "Usage: INGEST_SECRET=shh $0 <github-username>"
  exit 2
fi

if [ -z "$INGEST_SECRET" ]; then
  echo "Error: INGEST_SECRET environment variable is required."
  echo "Create it in your shell like: export INGEST_SECRET=your_secret"
  exit 2
fi

echo "Posting ingest request for '$USERNAME' to $URL"

response=$(curl -sS -w "\n%{http_code}" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -d "{\"username\": \"$USERNAME\"}")

# split body and http code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP $http_code"
if command -v jq >/dev/null 2>&1; then
  echo "$body" | jq .
else
  echo "$body"
fi

if [ "$http_code" -ge 400 ]; then
  exit 1
fi
