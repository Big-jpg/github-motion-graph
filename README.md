# GitHub Motion Graph

Interactive force-directed visualization of GitHub activity — repositories, commits, pull requests, and human/AI collaboration patterns.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

## Architecture

```
┌─────────────────────────────────────────────┐
│  Client (react-force-graph-2d)              │
│  Force-directed canvas visualization        │
├─────────────────────────────────────────────┤
│  Next.js App Router                         │
│  ├── / (landing)                            │
│  ├── /graph (full visualization)            │
│  └── /graph/[repo] (filtered view)          │
├─────────────────────────────────────────────┤
│  API Routes                                 │
│  ├── POST /api/ingest (Node.js runtime)     │
│  ├── GET  /api/graph  (Edge runtime)        │
│  └── GET  /api/stats  (Edge runtime)        │
├─────────────────────────────────────────────┤
│  Neon Postgres + Drizzle ORM                │
│  Relational graph model                     │
└─────────────────────────────────────────────┘
```

## Stack

- **Next.js 16** — App Router, React Server Components
- **TypeScript** — Strict mode
- **Neon Serverless Postgres** — `@neondatabase/serverless`
- **Drizzle ORM** — Type-safe schema and queries
- **react-force-graph-2d** — Canvas-based force simulation
- **Edge Runtime** — Lightweight read endpoints
- **Tailwind CSS v4** — Styling
- **@vercel/analytics** — Deployment analytics

## Data Model

Nodes: Repository, Branch, Commit, PullRequest, User  
Edges: AUTHORED, OPENED, MERGED, BELONGS_TO, TARGETS, FROM, PART_OF

## Getting Started

```bash
pnpm install
cp .env.example .env.local
# Fill in DATABASE_URL, GH_TOKEN, and INGEST_SECRET
pnpm dev
```

## Ingestion

The ingest endpoint creates a durable Neon-backed run and submits it to Vercel Queues. A discovery job paginates the complete repository inventory, then fans out one idempotent job per repository. Successful repositories stay complete when another repository fails or retries, and every attempt/result remains inspectable in the database.

The recommended on-demand helper loads `INGEST_SECRET`, `INGEST_URL`, and the optional `GITHUB_USERNAME` from `.env.local`:

```bash
pnpm ingest

# Or explicitly safety-check the GitHub account and narrow the run
pnpm ingest -- --username Big-jpg --repo Big-jpg/github-motion-graph

# Multiple repositories (quoting is portable across PowerShell and Unix shells)
pnpm ingest -- --repo "Big-jpg/ever-gauzy,Big-jpg/mindsdb"

# Queue without waiting, or resume watching later
pnpm ingest -- --no-wait
pnpm ingest -- --run <run-id>
```

Run `pnpm ingest -- --help` for branch, visibility, fork, affiliation, URL, and timeout controls. Direct HTTP invocation remains available for automation:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -d '{"username": "Big-jpg"}'
```

`username` is an optional safety check: when supplied, it must match the account that owns `GH_TOKEN`. It does not let one token read another user's private or organization data.

Scope can be narrowed in the request body:

```json
{
  "username": "Big-jpg",
  "repositoryNames": ["Big-jpg/github-motion-graph"],
  "visibility": "public",
  "includeForks": false,
  "forkMode": "shallow",
  "affiliations": ["OWNER", "COLLABORATOR"],
  "allBranches": false,
  "branches": ["main", "release"]
}
```

| Option | Default | Meaning |
|--------|---------|---------|
| `username` | authenticated viewer | Optional check that the expected account owns `GH_TOKEN` |
| `repositoryNames` | unset | Optional full `owner/name` allowlist for per-repository backfills and retries |
| `visibility` | `public` | `public`, `private`, or `all`; GitHub treats internal repositories as private for this filter |
| `includeForks` | `true` | Set `false` to exclude forks |
| `forkMode` | `shallow` | Forks ingest only their default branch, two commit pages, one PR page, and embedded PR commits. Use `full` to traverse them normally |
| `forkCommitPages` | `2` | Commit-history page cap per shallow fork branch (1–100) |
| `forkPullRequestPages` | `1` | Pull-request page cap per shallow fork (1–100) |
| `affiliations` | all three | Any non-empty subset of `OWNER`, `COLLABORATOR`, `ORGANIZATION_MEMBER` |
| `allBranches` | `true` | Set `false` to traverse only the default branch |
| `branches` | unset | Optional branch-name allowlist; when present it overrides `allBranches` |

`POST /api/ingest` returns HTTP 202 with `runId` and `statusUrl`. `GET /api/ingest/:runId` (with the same ingest secret) reports queued/running/completed/failed jobs, attempt counts, lease age, health (`in-flight`, `waiting-for-retry`, or `stale-lease`), and last errors. Runs finish as `complete` or `partial`; queue deliveries retry up to five times while graph writes remain idempotent. The CLI prints unfinished job details every 30 seconds even when aggregate counts do not change.

The current work unit is one repository. This removes the account-wide five-minute bottleneck. An exceptionally large single repository can later be split into branch/PR cursor jobs without changing the submit or status APIs.

For private or organization repositories, the token must have access to those repositories and any required organization SSO authorization. Fine-grained tokens should grant repository metadata and contents plus pull-request read access. Repository visibility is never broadened beyond what the token can see.

> [!WARNING]
> `/api/graph` and `/api/stats` are public read endpoints. Do not ingest private repositories into a publicly accessible deployment unless you add authentication to those endpoints first.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon Postgres connection string |
| `GH_TOKEN` | GitHub token whose authenticated viewer and accessible repositories will be ingested |
| `GH_REQUEST_TIMEOUT_MS` | Optional per-request GitHub timeout; defaults to 20000 |
| `GH_MAX_RETRIES` | Optional bounded retry count; defaults to 3 |
| `INGEST_SECRET` | Shared secret required for `POST /api/ingest` |
| `NEXT_PUBLIC_APP_URL` | Application URL |

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Big-jpg/github-motion-graph)
