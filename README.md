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

The ingest endpoint backfills every page of repositories, branches, branch histories, pull requests, and pull-request commits available to `GH_TOKEN`. By default it ingests the authenticated viewer's public repositories across owner, collaborator, and organization-member affiliations, includes forks, and traverses every branch.

The recommended on-demand helper loads `INGEST_SECRET`, `INGEST_URL`, and the optional `GITHUB_USERNAME` from `.env.local`:

```bash
pnpm ingest

# Or explicitly safety-check the GitHub account and narrow the run
pnpm ingest -- --username Big-jpg --repo Big-jpg/github-motion-graph
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
| `affiliations` | all three | Any non-empty subset of `OWNER`, `COLLABORATOR`, `ORGANIZATION_MEMBER` |
| `allBranches` | `true` | Set `false` to traverse only the default branch |
| `branches` | unset | Optional branch-name allowlist; when present it overrides `allBranches` |

The response reports expected and fetched connection counts, rows/links written, and a failure list. A fully complete run returns HTTP 200 with `success: true`; a run that completed only partially returns HTTP 207 with `success: false` and `status: "partial"`. GitHub requests use bounded retries for timeouts, transient failures, and short rate-limit waits.

Deep all-repository/all-branch backfills can exceed a serverless request budget on large accounts. Use `repositoryNames` to run recoverable repository-sized chunks; the repository inventory is still fully paginated before the allowlist is applied.

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
