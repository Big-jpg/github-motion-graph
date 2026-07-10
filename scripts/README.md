# scripts

This folder contains helper scripts for development and reproducible operations.

- `ingest.sh` / `ingest.ps1` — call the `/api/ingest` endpoint with a provided `INGEST_SECRET`.
- `pull-vercel-env.sh` / `pull-vercel-env.ps1` — pull environment variables from Vercel into a local `.env.local` file for local testing.

Security and workflow guidance

- Do NOT commit `.env.local` or any files with secrets. `.gitignore` already ignores `.env*local`.
- Prefer running `pull-vercel-env.*` with a short-lived Vercel token (or interactive login) and verify the vars locally.
- When testing against production data locally, ensure you understand data privacy and rate limits.

Examples

Bash:

```bash
# Pull production env and write to .env.local
VERCEL_TOKEN=xxx ./scripts/pull-vercel-env.sh --env production

# Run ingest against production using the INGEST_SECRET provided by prod
INGEST_SECRET=yyy ./scripts/ingest.sh Big-jpg
```

PowerShell:

```powershell
$env:VERCEL_TOKEN='xxx'
./scripts/pull-vercel-env.ps1 -Environment production
$env:INGEST_SECRET='yyy'
./scripts/ingest.ps1 -Username Big-jpg
```
