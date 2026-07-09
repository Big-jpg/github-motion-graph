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

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -d '{"username": "Big-jpg"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon Postgres connection string |
| `GH_TOKEN` | GitHub Personal Access Token |
| `INGEST_SECRET` | Shared secret required for `POST /api/ingest` |
| `NEXT_PUBLIC_APP_URL` | Application URL |

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Big-jpg/github-motion-graph)
