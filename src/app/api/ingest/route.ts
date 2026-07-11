// src/app/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import * as schema from '@/db/schema';
import {
  githubGraphQL,
  githubGraphQLPages,
  VIEWER_QUERY,
  REPOS_QUERY,
  BRANCHES_QUERY,
  COMMITS_QUERY,
  PRS_QUERY,
  PR_COMMITS_QUERY,
  type GitHubConnection,
  type RepoNode,
  type BranchNode,
  type CommitNode,
  type PRNode,
  type PullRequestCommitNode,
} from '@/lib/github';
import { ensureTables } from '@/db/migrate';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_AFFILIATIONS = ['OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER'] as const;
const VALID_AFFILIATIONS = new Set<string>(DEFAULT_AFFILIATIONS);

type Database = ReturnType<typeof drizzle>;
type Visibility = 'public' | 'private' | 'all';

interface IngestOptions {
  expectedUsername: string | null;
  visibility: Visibility;
  includeForks: boolean;
  allBranches: boolean;
  branches: Set<string> | null;
  repositoryNames: Set<string> | null;
  affiliations: string[];
}

interface IngestFailure {
  scope: 'repositories' | 'repository' | 'branches' | 'branch-history' | 'pull-requests' | 'pr-commits';
  message: string;
  repository?: string;
  branch?: string;
  pullRequest?: number;
  retryAfterMs?: number;
}

interface IngestStats {
  pages: {
    repositories: number;
    branches: number;
    branchHistories: number;
    pullRequests: number;
    pullRequestCommits: number;
  };
  expected: {
    repositories: number | null;
    branches: number;
    branchCommitMemberships: number;
    pullRequests: number;
    pullRequestCommitMemberships: number;
  };
  fetched: {
    repositories: number;
    selectedRepositories: number;
    branches: number;
    branchCommitMemberships: number;
    pullRequests: number;
    pullRequestCommitMemberships: number;
  };
  unique: {
    commits: number;
    users: number;
  };
  written: {
    repositoryUpserts: number;
    branchUpserts: number;
    commitUpserts: number;
    pullRequestUpserts: number;
    userUpserts: number;
    mergeEventUpserts: number;
    repositoryCommitLinksCreated: number;
    branchCommitLinksCreated: number;
    commitPullRequestLinksCreated: number;
  };
}

interface UserCacheEntry {
  id: number;
  avatarUrl: string | null;
  name: string | null;
  isBot: boolean;
}

interface IngestContext {
  db: Database;
  options: IngestOptions;
  stats: IngestStats;
  failures: IngestFailure[];
  userCache: Map<string, UserCacheEntry>;
  seenCommitShas: Set<string>;
}

interface RepositoriesData {
  viewer: { repositories: GitHubConnection<RepoNode> };
}

interface BranchesData {
  repository: { refs: GitHubConnection<BranchNode> } | null;
}

interface CommitsData {
  repository: {
    ref: { target: { history?: GitHubConnection<CommitNode> } | null } | null;
  } | null;
}

interface PullRequestsData {
  repository: { pullRequests: GitHubConnection<PRNode> } | null;
}

interface PullRequestCommitsData {
  repository: {
    pullRequest: { commits: GitHubConnection<PullRequestCommitNode> } | null;
  } | null;
}

function isBot(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.includes('manus') ||
    lower.includes('[bot]') ||
    lower.includes('dependabot') ||
    lower.includes('github-actions')
  );
}

function getSubmittedIngestSecret(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1] || request.headers.get('x-ingest-secret');
}

function secretMatches(expected: string, submitted: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const submittedBuffer = Buffer.from(submitted);
  return expectedBuffer.length === submittedBuffer.length && timingSafeEqual(expectedBuffer, submittedBuffer);
}

function verifyIngestSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'INGEST_SECRET is not configured' }, { status: 500 });
  }

  const submitted = getSubmittedIngestSecret(request);
  if (!submitted || !secretMatches(expected, submitted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { error: 'Unknown error' };

  const detailed = error as Error & {
    cause?: unknown;
    code?: string;
    detail?: string;
    hint?: string;
    status?: number;
    retryAfterMs?: number;
  };
  const cause =
    detailed.cause && typeof detailed.cause === 'object'
      ? (detailed.cause as { message?: string; code?: string; detail?: string; hint?: string })
      : null;

  return {
    error: detailed.message,
    code: detailed.code || cause?.code,
    detail: detailed.detail || cause?.detail,
    hint: detailed.hint || cause?.hint,
    cause: cause?.message,
    githubStatus: detailed.status,
    retryAfterMs: detailed.retryAfterMs,
  };
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
}

function parseOptions(body: unknown): IngestOptions {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be a JSON object');
  }
  const record = body as Record<string, unknown>;

  let expectedUsername: string | null = null;
  if (record.username !== undefined) {
    if (typeof record.username !== 'string' || !record.username.trim()) {
      throw new Error('username must be a non-empty string when provided');
    }
    expectedUsername = record.username.trim();
  }

  const visibilityValue = record.visibility ?? 'public';
  if (
    typeof visibilityValue !== 'string' ||
    !['public', 'private', 'all'].includes(visibilityValue.toLowerCase())
  ) {
    throw new Error('visibility must be public, private, or all');
  }
  const visibility = visibilityValue.toLowerCase() as Visibility;

  let branches: Set<string> | null = null;
  if (record.branches !== undefined) {
    if (!Array.isArray(record.branches) || record.branches.some((branch) => typeof branch !== 'string')) {
      throw new Error('branches must be an array of branch names');
    }
    branches = new Set(
      record.branches
        .map((branch) => (branch as string).trim())
        .filter((branch) => branch.length > 0),
    );
  }

  let repositoryNames: Set<string> | null = null;
  if (record.repositoryNames !== undefined) {
    if (
      !Array.isArray(record.repositoryNames) ||
      record.repositoryNames.some((repository) => typeof repository !== 'string')
    ) {
      throw new Error('repositoryNames must be an array of owner/name strings');
    }
    repositoryNames = new Set(
      record.repositoryNames
        .map((repository) => (repository as string).trim().toLowerCase())
        .filter((repository) => repository.length > 0),
    );
    if (repositoryNames.size === 0) throw new Error('repositoryNames cannot be empty');
  }

  let affiliations = [...DEFAULT_AFFILIATIONS];
  if (record.affiliations !== undefined) {
    if (!Array.isArray(record.affiliations) || record.affiliations.length === 0) {
      throw new Error('affiliations must be a non-empty array');
    }
    affiliations = record.affiliations.map((affiliation) => {
      if (typeof affiliation !== 'string') throw new Error('affiliations must contain strings');
      const normalized = affiliation.toUpperCase();
      if (!VALID_AFFILIATIONS.has(normalized)) {
        throw new Error(`Unsupported affiliation: ${affiliation}`);
      }
      return normalized as (typeof DEFAULT_AFFILIATIONS)[number];
    });
  }

  return {
    expectedUsername,
    visibility,
    includeForks: readBoolean(record, 'includeForks', true),
    allBranches: readBoolean(record, 'allBranches', true),
    branches,
    repositoryNames,
    affiliations: [...new Set(affiliations)],
  };
}

function createStats(): IngestStats {
  return {
    pages: {
      repositories: 0,
      branches: 0,
      branchHistories: 0,
      pullRequests: 0,
      pullRequestCommits: 0,
    },
    expected: {
      repositories: null,
      branches: 0,
      branchCommitMemberships: 0,
      pullRequests: 0,
      pullRequestCommitMemberships: 0,
    },
    fetched: {
      repositories: 0,
      selectedRepositories: 0,
      branches: 0,
      branchCommitMemberships: 0,
      pullRequests: 0,
      pullRequestCommitMemberships: 0,
    },
    unique: { commits: 0, users: 0 },
    written: {
      repositoryUpserts: 0,
      branchUpserts: 0,
      commitUpserts: 0,
      pullRequestUpserts: 0,
      userUpserts: 0,
      mergeEventUpserts: 0,
      repositoryCommitLinksCreated: 0,
      branchCommitLinksCreated: 0,
      commitPullRequestLinksCreated: 0,
    },
  };
}

function recordFailure(
  context: IngestContext,
  failure: Omit<IngestFailure, 'message' | 'retryAfterMs'>,
  error: unknown,
) {
  const details = serializeError(error);
  context.failures.push({
    ...failure,
    message: details.error,
    retryAfterMs: details.retryAfterMs,
  });
  console.error(`Ingestion ${failure.scope} failure:`, failure, error);
}

async function upsertUser(
  context: IngestContext,
  login: string,
  avatarUrl?: string | null,
  name?: string | null,
): Promise<number> {
  const normalizedLogin = login.trim();
  const nextAvatar = avatarUrl || null;
  const nextName = name || null;
  const bot = isBot(normalizedLogin) || isBot(nextName);
  const cached = context.userCache.get(normalizedLogin);

  if (
    cached &&
    (!nextAvatar || cached.avatarUrl === nextAvatar) &&
    (!nextName || cached.name === nextName) &&
    cached.isBot === bot
  ) {
    return cached.id;
  }

  const result = await context.db
    .insert(schema.users)
    .values({
      login: normalizedLogin,
      avatarUrl: nextAvatar,
      isBot: bot,
      name: nextName,
    })
    .onConflictDoUpdate({
      target: schema.users.login,
      set: {
        avatarUrl: sql`COALESCE(excluded.avatar_url, ${schema.users.avatarUrl})`,
        isBot: bot,
        name: sql`COALESCE(excluded.name, ${schema.users.name})`,
      },
    })
    .returning({ id: schema.users.id });

  if (!result[0]) throw new Error(`Unable to upsert GitHub user ${normalizedLogin}`);
  context.stats.written.userUpserts++;
  context.userCache.set(normalizedLogin, {
    id: result[0].id,
    avatarUrl: nextAvatar || cached?.avatarUrl || null,
    name: nextName || cached?.name || null,
    isBot: bot,
  });
  context.stats.unique.users = context.userCache.size;
  return result[0].id;
}

function syntheticLogin(author: NonNullable<CommitNode['author']>): string | null {
  if (author.email) return author.email.toLowerCase();
  if (!author.name) return null;
  const slug = author.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `git:${slug}` : null;
}

async function commitAuthorId(context: IngestContext, commit: CommitNode): Promise<number | null> {
  const author = commit.author;
  if (!author) return null;
  if (author.user?.login) {
    return upsertUser(context, author.user.login, author.user.avatarUrl, author.name);
  }
  const login = syntheticLogin(author);
  return login ? upsertUser(context, login, null, author.name) : null;
}

async function persistCommitPage(
  context: IngestContext,
  commits: CommitNode[],
  repositoryId: number,
  branchId: number | null,
): Promise<Map<string, number>> {
  const uniqueCommits = [...new Map(commits.map((commit) => [commit.oid, commit])).values()];
  if (uniqueCommits.length === 0) return new Map();

  const rows: Array<typeof schema.commits.$inferInsert> = [];
  for (const commit of uniqueCommits) {
    const userId = await commitAuthorId(context, commit);
    rows.push({
      sha: commit.oid,
      message: commit.message,
      authorName: commit.author?.name || null,
      authorEmail: commit.author?.email || null,
      committedAt: new Date(commit.committedDate),
      repositoryId,
      branchId,
      userId,
    });
    context.seenCommitShas.add(commit.oid);
  }
  context.stats.unique.commits = context.seenCommitShas.size;

  const persisted = await context.db
    .insert(schema.commits)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.commits.sha,
      set: {
        message: sql`excluded.message`,
        authorName: sql`COALESCE(excluded.author_name, ${schema.commits.authorName})`,
        authorEmail: sql`COALESCE(excluded.author_email, ${schema.commits.authorEmail})`,
        committedAt: sql`excluded.committed_at`,
        userId: sql`COALESCE(excluded.user_id, ${schema.commits.userId})`,
      },
    })
    .returning({ id: schema.commits.id, sha: schema.commits.sha });
  context.stats.written.commitUpserts += persisted.length;

  const commitIds = new Map(persisted.map((commit) => [commit.sha, commit.id]));
  const ids = [...new Set(persisted.map((commit) => commit.id))];

  if (ids.length > 0) {
    const repositoryLinks = await context.db
      .insert(schema.repositoryCommits)
      .values(ids.map((commitId) => ({ repositoryId, commitId })))
      .onConflictDoNothing({
        target: [schema.repositoryCommits.repositoryId, schema.repositoryCommits.commitId],
      })
      .returning({ id: schema.repositoryCommits.id });
    context.stats.written.repositoryCommitLinksCreated += repositoryLinks.length;

    if (branchId !== null) {
      const branchLinks = await context.db
        .insert(schema.branchCommits)
        .values(ids.map((commitId) => ({ branchId, commitId })))
        .onConflictDoNothing({
          target: [schema.branchCommits.branchId, schema.branchCommits.commitId],
        })
        .returning({ id: schema.branchCommits.id });
      context.stats.written.branchCommitLinksCreated += branchLinks.length;
    }
  }

  return commitIds;
}

async function upsertRepository(context: IngestContext, repo: RepoNode): Promise<number> {
  const defaultBranch = repo.defaultBranchRef?.name || null;
  const values: typeof schema.repositories.$inferInsert = {
    nodeId: repo.id,
    name: repo.name,
    fullName: repo.nameWithOwner,
    ownerLogin: repo.owner.login,
    description: repo.description,
    url: repo.url,
    defaultBranch,
    createdAt: new Date(repo.createdAt),
    updatedAt: new Date(repo.updatedAt),
    pushedAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
    stargazerCount: repo.stargazerCount,
    language: repo.primaryLanguage?.name || null,
    isFork: repo.isFork,
    isPrivate: repo.isPrivate,
  };

  const result = await context.db
    .insert(schema.repositories)
    .values(values)
    .onConflictDoUpdate({
      target: schema.repositories.nodeId,
      set: {
        name: values.name,
        fullName: values.fullName,
        ownerLogin: values.ownerLogin,
        description: values.description,
        url: values.url,
        defaultBranch: values.defaultBranch,
        createdAt: values.createdAt,
        updatedAt: values.updatedAt,
        pushedAt: values.pushedAt,
        stargazerCount: values.stargazerCount,
        language: values.language,
        isFork: values.isFork,
        isPrivate: values.isPrivate,
      },
    })
    .returning({ id: schema.repositories.id });

  if (!result[0]) throw new Error(`Unable to upsert repository ${repo.nameWithOwner}`);
  context.stats.written.repositoryUpserts++;
  return result[0].id;
}

async function ingestBranches(
  context: IngestContext,
  repo: RepoNode,
  repositoryId: number,
): Promise<Map<string, number>> {
  const branchIds = new Map<string, number>();
  const owner = repo.owner.login;

  try {
    for await (const page of githubGraphQLPages<BranchesData, BranchNode>(
      BRANCHES_QUERY,
      { owner, name: repo.name },
      (data) => data.repository?.refs,
    )) {
      context.stats.pages.branches++;
      if (page.pageNumber === 1 && page.totalCount !== null) {
        context.stats.expected.branches += page.totalCount;
      }
      context.stats.fetched.branches += page.nodes.length;
      if (page.nodes.length === 0) continue;

      const rows: Array<typeof schema.branches.$inferInsert> = page.nodes.map((branch) => ({
        name: branch.name,
        repositoryId,
        isDefault: branch.name === repo.defaultBranchRef?.name,
        createdAt: branch.target?.committedDate ? new Date(branch.target.committedDate) : null,
      }));
      const persisted = await context.db
        .insert(schema.branches)
        .values(rows)
        .onConflictDoUpdate({
          target: [schema.branches.repositoryId, schema.branches.name],
          set: {
            isDefault: sql`excluded.is_default`,
            createdAt: sql`excluded.created_at`,
          },
        })
        .returning({ id: schema.branches.id, name: schema.branches.name });
      context.stats.written.branchUpserts += persisted.length;
      for (const branch of persisted) branchIds.set(branch.name, branch.id);
    }
  } catch (error) {
    recordFailure(context, { scope: 'branches', repository: repo.nameWithOwner }, error);
  }

  return branchIds;
}

function shouldIngestBranch(context: IngestContext, repo: RepoNode, branch: string): boolean {
  if (context.options.branches) return context.options.branches.has(branch);
  if (context.options.allBranches) return true;
  return branch === repo.defaultBranchRef?.name;
}

async function ingestBranchHistories(
  context: IngestContext,
  repo: RepoNode,
  repositoryId: number,
  branchIds: Map<string, number>,
) {
  const owner = repo.owner.login;

  for (const [branchName, branchId] of branchIds) {
    if (!shouldIngestBranch(context, repo, branchName)) continue;

    try {
      for await (const page of githubGraphQLPages<CommitsData, CommitNode>(
        COMMITS_QUERY,
        { owner, name: repo.name, branch: `refs/heads/${branchName}` },
        (data) => data.repository?.ref?.target?.history,
      )) {
        context.stats.pages.branchHistories++;
        if (page.pageNumber === 1 && page.totalCount !== null) {
          context.stats.expected.branchCommitMemberships += page.totalCount;
        }
        context.stats.fetched.branchCommitMemberships += page.nodes.length;
        await persistCommitPage(context, page.nodes, repositoryId, branchId);
      }
    } catch (error) {
      recordFailure(
        context,
        { scope: 'branch-history', repository: repo.nameWithOwner, branch: branchName },
        error,
      );
    }
  }
}

async function ingestPullRequestCommits(
  context: IngestContext,
  repo: RepoNode,
  repositoryId: number,
  branchIds: Map<string, number>,
  pullRequest: PRNode,
  pullRequestId: number,
) {
  const owner = repo.owner.login;
  const headBranchId =
    pullRequest.headRepository?.nameWithOwner === repo.nameWithOwner
      ? branchIds.get(pullRequest.headRefName) || null
      : null;

  const persistAndLink = async (nodes: PullRequestCommitNode[]) => {
    context.stats.pages.pullRequestCommits++;
    context.stats.fetched.pullRequestCommitMemberships += nodes.length;
    const commitIds = await persistCommitPage(
      context,
      nodes.map((node) => node.commit),
      repositoryId,
      headBranchId,
    );
    const ids = [...new Set(commitIds.values())];
    if (ids.length === 0) return;

    const links = await context.db
      .insert(schema.commitPullRequests)
      .values(ids.map((commitId) => ({ commitId, pullRequestId })))
      .onConflictDoNothing({
        target: [schema.commitPullRequests.commitId, schema.commitPullRequests.pullRequestId],
      })
      .returning({ id: schema.commitPullRequests.id });
    context.stats.written.commitPullRequestLinksCreated += links.length;
  };

  try {
    const firstPage = pullRequest.commits;
    context.stats.expected.pullRequestCommitMemberships += firstPage.totalCount || 0;
    await persistAndLink((firstPage.nodes || []).filter((node): node is PullRequestCommitNode => node !== null));

    if (!firstPage.pageInfo.hasNextPage) return;
    if (!firstPage.pageInfo.endCursor) {
      throw new Error('Pull request commits have another page but no end cursor');
    }

    for await (const page of githubGraphQLPages<PullRequestCommitsData, PullRequestCommitNode>(
      PR_COMMITS_QUERY,
      { owner, name: repo.name, number: pullRequest.number },
      (data) => data.repository?.pullRequest?.commits,
      firstPage.pageInfo.endCursor,
    )) {
      await persistAndLink(page.nodes);
    }
  } catch (error) {
    recordFailure(
      context,
      {
        scope: 'pr-commits',
        repository: repo.nameWithOwner,
        pullRequest: pullRequest.number,
      },
      error,
    );
  }
}

async function ingestPullRequests(
  context: IngestContext,
  repo: RepoNode,
  repositoryId: number,
  branchIds: Map<string, number>,
) {
  const owner = repo.owner.login;

  try {
    for await (const page of githubGraphQLPages<PullRequestsData, PRNode>(
      PRS_QUERY,
      { owner, name: repo.name },
      (data) => data.repository?.pullRequests,
    )) {
      context.stats.pages.pullRequests++;
      if (page.pageNumber === 1 && page.totalCount !== null) {
        context.stats.expected.pullRequests += page.totalCount;
      }
      context.stats.fetched.pullRequests += page.nodes.length;
      if (page.nodes.length === 0) continue;

      const prepared: Array<{
        pullRequest: PRNode;
        authorId: number | null;
        mergedById: number | null;
      }> = [];
      for (const pullRequest of page.nodes) {
        const authorId = pullRequest.author?.login
          ? await upsertUser(context, pullRequest.author.login, pullRequest.author.avatarUrl)
          : null;
        const mergedById = pullRequest.mergedBy?.login
          ? await upsertUser(context, pullRequest.mergedBy.login, pullRequest.mergedBy.avatarUrl)
          : null;
        prepared.push({ pullRequest, authorId, mergedById });
      }

      const rows: Array<typeof schema.pullRequests.$inferInsert> = prepared.map(
        ({ pullRequest, authorId }) => ({
          nodeId: pullRequest.id,
          number: pullRequest.number,
          title: pullRequest.title,
          state: pullRequest.state,
          createdAt: new Date(pullRequest.createdAt),
          mergedAt: pullRequest.mergedAt ? new Date(pullRequest.mergedAt) : null,
          closedAt: pullRequest.closedAt ? new Date(pullRequest.closedAt) : null,
          additions: pullRequest.additions,
          deletions: pullRequest.deletions,
          headBranch: pullRequest.headRefName,
          baseBranch: pullRequest.baseRefName,
          headRepositoryFullName: pullRequest.headRepository?.nameWithOwner ?? null,
          repositoryId,
          authorId,
        }),
      );
      const persisted = await context.db
        .insert(schema.pullRequests)
        .values(rows)
        .onConflictDoUpdate({
          target: schema.pullRequests.nodeId,
          set: {
            number: sql`excluded.number`,
            title: sql`excluded.title`,
            state: sql`excluded.state`,
            createdAt: sql`excluded.created_at`,
            mergedAt: sql`excluded.merged_at`,
            closedAt: sql`excluded.closed_at`,
            additions: sql`excluded.additions`,
            deletions: sql`excluded.deletions`,
            headBranch: sql`excluded.head_branch`,
            baseBranch: sql`excluded.base_branch`,
            headRepositoryFullName: sql`excluded.head_repository_full_name`,
            repositoryId: sql`excluded.repository_id`,
            authorId: sql`excluded.author_id`,
          },
        })
        .returning({ id: schema.pullRequests.id, nodeId: schema.pullRequests.nodeId });
      context.stats.written.pullRequestUpserts += persisted.length;
      const pullRequestIds = new Map(persisted.map((pullRequest) => [pullRequest.nodeId, pullRequest.id]));

      const mergeRows: Array<typeof schema.mergeEvents.$inferInsert> = [];
      for (const item of prepared) {
        const pullRequestId = pullRequestIds.get(item.pullRequest.id);
        if (pullRequestId && item.pullRequest.mergedAt) {
          mergeRows.push({
            prId: pullRequestId,
            mergedById: item.mergedById,
            mergedAt: new Date(item.pullRequest.mergedAt),
            repositoryId,
          });
        }
      }
      if (mergeRows.length > 0) {
        const mergeEvents = await context.db
          .insert(schema.mergeEvents)
          .values(mergeRows)
          .onConflictDoUpdate({
            target: schema.mergeEvents.prId,
            set: {
              mergedById: sql`excluded.merged_by_id`,
              mergedAt: sql`excluded.merged_at`,
              repositoryId: sql`excluded.repository_id`,
            },
          })
          .returning({ id: schema.mergeEvents.id });
        context.stats.written.mergeEventUpserts += mergeEvents.length;
      }

      for (const item of prepared) {
        const pullRequestId = pullRequestIds.get(item.pullRequest.id);
        if (!pullRequestId) {
          recordFailure(
            context,
            {
              scope: 'pr-commits',
              repository: repo.nameWithOwner,
              pullRequest: item.pullRequest.number,
            },
            new Error('Pull request upsert did not return an id'),
          );
          continue;
        }
        await ingestPullRequestCommits(
          context,
          repo,
          repositoryId,
          branchIds,
          item.pullRequest,
          pullRequestId,
        );
      }
    }
  } catch (error) {
    recordFailure(context, { scope: 'pull-requests', repository: repo.nameWithOwner }, error);
  }
}

async function ingestRepository(context: IngestContext, repo: RepoNode) {
  let repositoryId: number;
  try {
    repositoryId = await upsertRepository(context, repo);
  } catch (error) {
    recordFailure(context, { scope: 'repository', repository: repo.nameWithOwner }, error);
    return;
  }

  const branchIds = await ingestBranches(context, repo, repositoryId);
  await ingestBranchHistories(context, repo, repositoryId, branchIds);
  await ingestPullRequests(context, repo, repositoryId, branchIds);
}

export async function POST(request: NextRequest) {
  const authError = verifyIngestSecret(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, complete: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let options: IngestOptions;
  try {
    options = parseOptions(body);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        complete: false,
        error: error instanceof Error ? error.message : 'Invalid ingest options',
      },
      { status: 400 },
    );
  }

  try {
    await ensureTables();

    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });
    const viewerData = await githubGraphQL<{ viewer: { login: string } }>(VIEWER_QUERY);
    const viewerLogin = viewerData.viewer.login;

    if (
      options.expectedUsername &&
      options.expectedUsername.toLowerCase() !== viewerLogin.toLowerCase()
    ) {
      return NextResponse.json(
        {
          success: false,
          complete: false,
          error: `GH_TOKEN belongs to ${viewerLogin}, not ${options.expectedUsername}`,
        },
        { status: 400 },
      );
    }

    const context: IngestContext = {
      db,
      options,
      stats: createStats(),
      failures: [],
      userCache: new Map(),
      seenCommitShas: new Set(),
    };
    const matchedRepositoryNames = new Set<string>();

    try {
      for await (const page of githubGraphQLPages<RepositoriesData, RepoNode>(
        REPOS_QUERY,
        {
          affiliations: options.affiliations,
          isFork: options.includeForks ? null : false,
          privacy: options.visibility === 'all' ? null : options.visibility.toUpperCase(),
        },
        (data) => data.viewer.repositories,
      )) {
        context.stats.pages.repositories++;
        if (page.pageNumber === 1) context.stats.expected.repositories = page.totalCount;
        context.stats.fetched.repositories += page.nodes.length;
        for (const repo of page.nodes) {
          const normalizedName = repo.nameWithOwner.toLowerCase();
          if (options.repositoryNames && !options.repositoryNames.has(normalizedName)) continue;
          matchedRepositoryNames.add(normalizedName);
          context.stats.fetched.selectedRepositories++;
          await ingestRepository(context, repo);
        }
      }
    } catch (error) {
      recordFailure(context, { scope: 'repositories' }, error);
    }

    if (options.repositoryNames) {
      for (const requestedName of options.repositoryNames) {
        if (matchedRepositoryNames.has(requestedName)) continue;
        recordFailure(
          context,
          { scope: 'repository', repository: requestedName },
          new Error('Requested repository was not found in the selected visibility/affiliation scope'),
        );
      }
    }

    context.stats.unique.commits = context.seenCommitShas.size;
    context.stats.unique.users = context.userCache.size;
    const complete = context.failures.length === 0;

    return NextResponse.json(
      {
        success: complete,
        complete,
        status: complete ? 'complete' : 'partial',
        viewer: viewerLogin,
        scope: {
          visibility: options.visibility,
          includeForks: options.includeForks,
          affiliations: options.affiliations,
          allBranches: options.allBranches,
          branches: options.branches ? [...options.branches] : null,
          repositoryNames: options.repositoryNames ? [...options.repositoryNames] : null,
        },
        stats: context.stats,
        failures: context.failures,
        message: complete
          ? `Completed GitHub ingestion for ${viewerLogin}`
          : `GitHub ingestion for ${viewerLogin} completed with ${context.failures.length} failure(s)`,
      },
      { status: complete ? 200 : 207 },
    );
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { success: false, complete: false, status: 'failed', ...serializeError(error) },
      { status: 500 },
    );
  }
}
