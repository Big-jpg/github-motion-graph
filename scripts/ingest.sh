#!/usr/bin/env bash
set -euo pipefail

# scripts/ingest.sh
# Usage:
#   INGEST_SECRET=shh ./scripts/ingest.sh Big-jpg
# Optional environment variables:
#   INGEST_URL - override the ingest endpoint (default: https://github-motion-graph.vercel.app/api/ingest)
#   INGEST_BODY - override the JSON request body to set visibility/fork/branch options
# Notes:
# - The endpoint expects the ingest secret in the Authorization header (Bearer <INGEST_SECRET>).
# - The server uses GH_TOKEN (server-side) to call GitHub; you don't need to send GH_TOKEN to the endpoint.

URL="${INGEST_URL:-https://github-motion-graph.vercel.app/api/ingest}"
USERNAME="${1:-}"
INGEST_SECRET="${INGEST_SECRET:-}"
INGEST_BODY="${INGEST_BODY:-}"

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

if [ -n "$INGEST_BODY" ]; then
  request_body="$INGEST_BODY"
else
  request_body="{\"username\": \"$USERNAME\"}"
fi

response=$(curl -sS -w "\n%{http_code}" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -d "$request_body")

# split body and http code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP $http_code"
success_ok=true
if command -v jq >/dev/null 2>&1; then
  echo "$body" | jq .
  if ! echo "$body" | jq -e '.success == true' >/dev/null 2>&1; then
    success_ok=false
  fi
else
  echo "$body"
fi

if [ "$http_code" -ge 400 ] || [ "$http_code" -eq 207 ] || [ "$success_ok" != true ]; then
  exit 1
fi
