# scripts

This folder contains helper scripts for development and reproducible operations.

- `ingest.mjs` — recommended cross-platform helper exposed as `pnpm ingest`.
- `ingest.sh` / `ingest.ps1` — call the `/api/ingest` endpoint with a provided `INGEST_SECRET`.
- `pull-vercel-env.sh` / `pull-vercel-env.ps1` — pull environment variables from Vercel into a local `.env.local` file for local testing.

Security and workflow guidance

- Do NOT commit `.env.local` or any files with secrets. `.gitignore` already ignores `.env*local`.
- Prefer running `pull-vercel-env.*` with a short-lived Vercel token (or interactive login) and verify the vars locally.
- When testing against production data locally, ensure you understand data privacy and rate limits.

Examples

Recommended cross-platform helper:

```bash
# Full public backfill using GITHUB_USERNAME/INGEST_URL from .env.local
pnpm ingest

# Explicit viewer safety check
pnpm ingest -- --username Big-jpg

# Faster repository-scoped refresh
pnpm ingest -- --username Big-jpg --repo Big-jpg/github-motion-graph

# Smaller history scope for a large repository
pnpm ingest -- --repo Big-jpg/github-motion-graph --default-branch-only

# Detach and resume watching the durable run later
pnpm ingest -- --no-wait
pnpm ingest -- --run <run-id>
```

Run `pnpm ingest -- --help` for visibility, fork, affiliation, branch, URL, wait, and timeout options. The helper submits a queue run and polls its status; Ctrl+C does not cancel server-side work. It never accepts the ingest secret as a command-line argument, reading it from the shell, `.env.local`, or `.env` instead.

Bash:

```bash
# Pull production env and write to .env.local
VERCEL_TOKEN=xxx ./scripts/pull-vercel-env.sh --env production

# Run ingest against production using the INGEST_SECRET provided by prod
INGEST_SECRET=yyy ./scripts/ingest.sh Big-jpg

# Narrow the default public/all-affiliations/all-branches scope with a raw body
INGEST_SECRET=yyy \
INGEST_BODY='{"username":"Big-jpg","includeForks":false,"allBranches":false}' \
./scripts/ingest.sh Big-jpg
```

PowerShell:

```powershell
$env:VERCEL_TOKEN='xxx'
./scripts/pull-vercel-env.ps1 -Environment production
$env:INGEST_SECRET='yyy'
./scripts/ingest.ps1 -Username Big-jpg

# Public owner repos only, without forks, traversing just main
./scripts/ingest.ps1 -Username Big-jpg `
  -RepositoryNames Big-jpg/github-motion-graph `
  -Affiliations OWNER `
  -ExcludeForks `
  -Branches main
```

The username is an optional safety check in the PowerShell script and is included by the Bash helper. It must match the authenticated viewer for the server-side `GH_TOKEN`. The token determines which repositories can actually be read; private and organization repositories require matching token access and organization authorization.

The endpoint defaults to public repositories across `OWNER`, `COLLABORATOR`, and `ORGANIZATION_MEMBER`, includes forks, and traverses all branches. See the root README for the complete request schema and partial-run response format.

Both helpers exit non-zero for partial (`HTTP 207`) and failed runs so they are safe to use in scheduled jobs.
