// src/lib/mock-data.ts
import { useMemo } from 'react';
import type { GraphData } from './types';

export function useMockData(): GraphData {
  return useMemo(() => generateMockData(), []);
}

export function generateMockData(): GraphData {
  const nodes = [];
  const edges = [];

  // Repositories
  const repos = [
    { id: 'repo:1', name: 'github-motion-graph', language: 'TypeScript' },
    { id: 'repo:2', name: 'arcvane-studio', language: 'TypeScript' },
    { id: 'repo:3', name: 'plankz-deckz', language: 'TypeScript' },
    { id: 'repo:4', name: 'modelviz', language: 'TypeScript' },
    { id: 'repo:5', name: 'pbn-generator', language: 'TypeScript' },
    { id: 'repo:6', name: 'pglite-patient-risk', language: 'TypeScript' },
    { id: 'repo:7', name: 'fabric-extension', language: 'TypeScript' },
    { id: 'repo:8', name: 'rayfin-dashboard', language: 'TypeScript' },
  ];

  for (const repo of repos) {
    nodes.push({
      id: repo.id,
      type: 'repository' as const,
      label: repo.name,
      metadata: { language: repo.language, stars: Math.floor(Math.random() * 50) },
    });
  }

  // Users
  const users = [
    { id: 'user:1', login: 'Big-jpg', isBot: false },
    { id: 'user:2', login: 'atom-rossf', isBot: false },
    { id: 'user:3', login: 'manus-ai', isBot: true },
    { id: 'user:4', login: 'dependabot[bot]', isBot: true },
  ];

  for (const user of users) {
    nodes.push({
      id: user.id,
      type: 'user' as const,
      label: user.login,
      metadata: { isBot: user.isBot },
    });
  }

  // Branches per repo
  let branchId = 1;
  for (const repo of repos) {
    const branchNames = ['main', 'develop', 'feature/ui', 'fix/edge-cases'];
    for (const name of branchNames.slice(0, 2 + Math.floor(Math.random() * 3))) {
      const bid = `branch:${branchId}`;
      nodes.push({
        id: bid,
        type: 'branch' as const,
        label: name,
        metadata: { isDefault: name === 'main', repositoryId: repo.id },
      });
      edges.push({ source: bid, target: repo.id, type: 'BELONGS_TO', weight: 1 });
      branchId++;
    }
  }

  // Commits
  let commitId = 1;
  for (const repo of repos) {
    const repoBranches = nodes.filter(n => n.type === 'branch' && n.metadata.repositoryId === repo.id);
    const numCommits = 5 + Math.floor(Math.random() * 15);

    for (let i = 0; i < numCommits; i++) {
      const cid = `commit:${commitId}`;
      const author = users[Math.floor(Math.random() * users.length)];
      const branch = repoBranches[Math.floor(Math.random() * repoBranches.length)];

      nodes.push({
        id: cid,
        type: 'commit' as const,
        label: Math.random().toString(36).substring(2, 9),
        metadata: {
          message: randomCommitMessage(),
          authorName: author.login,
          committedAt: randomDate(),
        },
      });

      // Commit → Branch
      if (branch) {
        edges.push({ source: cid, target: branch.id, type: 'BELONGS_TO', weight: 0.5 });
      }

      // User → Commit
      edges.push({ source: author.id, target: cid, type: 'AUTHORED', weight: 1 });

      commitId++;
    }
  }

  // Pull Requests
  let prId = 1;
  for (const repo of repos) {
    const numPRs = 2 + Math.floor(Math.random() * 6);
    const repoBranches = nodes.filter(n => n.type === 'branch' && n.metadata.repositoryId === repo.id);

    for (let i = 0; i < numPRs; i++) {
      const pid = `pr:${prId}`;
      const author = users[Math.floor(Math.random() * users.length)];
      const state = Math.random() > 0.3 ? 'MERGED' : 'OPEN';

      nodes.push({
        id: pid,
        type: 'pullRequest' as const,
        label: `#${prId}`,
        metadata: {
          title: randomPRTitle(),
          state,
          additions: Math.floor(Math.random() * 500),
          deletions: Math.floor(Math.random() * 200),
        },
      });

      // User → PR
      edges.push({ source: author.id, target: pid, type: 'OPENED', weight: 2 });

      // PR → Branch (target)
      const baseBranch = repoBranches.find(b => b.label === 'main') || repoBranches[0];
      if (baseBranch) {
        edges.push({ source: pid, target: baseBranch.id, type: 'TARGETS', weight: 1.5 });
      }

      // Merge event
      if (state === 'MERGED') {
        const merger = users[Math.floor(Math.random() * 2)]; // human mergers
        edges.push({ source: merger.id, target: pid, type: 'MERGED', weight: 3 });
      }

      prId++;
    }
  }

  return { nodes, edges };
}

function randomCommitMessage(): string {
  const messages = [
    'feat: add force graph visualization',
    'fix: resolve edge rendering issue',
    'chore: update dependencies',
    'feat: implement GitHub ingestion',
    'fix: correct edge runtime config',
    'feat: add dark theme styling',
    'refactor: optimize graph queries',
    'feat: add filter controls',
    'fix: handle empty state',
    'chore: configure Drizzle schema',
    'feat: implement PR tracking',
    'fix: resolve type errors',
    'feat: add Neon Postgres connection',
    'docs: update README',
    'feat: add Vercel analytics',
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function randomPRTitle(): string {
  const titles = [
    'Add interactive force graph',
    'Implement GitHub GraphQL ingestion',
    'Configure edge runtime endpoints',
    'Add Neon Postgres integration',
    'Implement filter controls',
    'Add dark theme with glow effects',
    'Fix node rendering performance',
    'Add bot/AI contributor detection',
    'Implement zoom and pan controls',
    'Add repository detail view',
  ];
  return titles[Math.floor(Math.random() * titles.length)];
}

function randomDate(): string {
  const now = Date.now();
  const past = now - Math.random() * 90 * 24 * 60 * 60 * 1000;
  return new Date(past).toISOString();
}
