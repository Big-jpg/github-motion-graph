// src/app/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import * as schema from '@/db/schema';
import {
  githubGraphQL,
  REPOS_QUERY,
  BRANCHES_QUERY,
  COMMITS_QUERY,
  PRS_QUERY,
  RepoNode,
  BranchNode,
  CommitNode,
  PRNode,
} from '@/lib/github';
import { createTables } from '@/db/migrate';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isBot(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.includes('manus') || lower.includes('[bot]') || lower.includes('dependabot') || lower.includes('github-actions');
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
  if (!(error instanceof Error)) {
    return { error: 'Unknown error' };
  }

  const maybeDetailedError = error as Error & {
    cause?: unknown;
    code?: string;
    detail?: string;
    hint?: string;
  };
  const cause =
    maybeDetailedError.cause && typeof maybeDetailedError.cause === 'object'
      ? (maybeDetailedError.cause as { message?: string; code?: string; detail?: string; hint?: string })
      : null;

  return {
    error: maybeDetailedError.message,
    code: maybeDetailedError.code || cause?.code,
    detail: maybeDetailedError.detail || cause?.detail,
    hint: maybeDetailedError.hint || cause?.hint,
    cause: cause?.message,
  };
}

async function getOrCreateUser(db: ReturnType<typeof drizzle>, login: string, avatarUrl?: string, name?: string | null) {
  const existing = await db.select().from(schema.users).where(eq(schema.users.login, login)).limit(1);
  if (existing.length > 0) {
    return existing[0].id;
  }
  const isBotUser = isBot(login) || isBot(name);
  const result = await db.insert(schema.users).values({
    login,
    avatarUrl: avatarUrl || null,
    isBot: isBotUser,
    name: name || null,
  }).onConflictDoUpdate({
    target: schema.users.login,
    set: {
      avatarUrl: avatarUrl || null,
      isBot: isBotUser,
      name: name || null,
    },
  }).returning({ id: schema.users.id });
  return result[0].id;
}

export async function POST(request: NextRequest) {
  try {
    const authError = verifyIngestSecret(request);
    if (authError) return authError;

    const body = await request.json();
    const username = body.username as string;
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const db = drizzle(sql, { schema });

    // Ensure tables exist
    await createTables();

    // Fetch repositories (paginate to collect all pages)
    const repos: RepoNode[] = [];
    let reposCursor: string | undefined | null = null;
    while (true) {
      const reposData = await githubGraphQL<{
        user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RepoNode[] } }
      }>(REPOS_QUERY, { login: username, cursor: reposCursor });

      const nodes = reposData.user.repositories.nodes || [];
      repos.push(...nodes);

      const pageInfo = reposData.user.repositories.pageInfo;
      if (!pageInfo || !pageInfo.hasNextPage) break;
      reposCursor = pageInfo.endCursor;
    }
    const stats = { repos: 0, branches: 0, commits: 0, prs: 0, users: 0 };

    for (const repo of repos) {
      // Upsert repository
      const repoResult = await db.insert(schema.repositories).values({
        nodeId: repo.id,
        name: repo.name,
        fullName: repo.nameWithOwner,
        description: repo.description,
        url: repo.url,
        defaultBranch: repo.defaultBranchRef?.name || 'main',
        createdAt: new Date(repo.createdAt),
        updatedAt: new Date(repo.updatedAt),
        pushedAt: new Date(repo.pushedAt),
        stargazerCount: repo.stargazerCount,
        language: repo.primaryLanguage?.name || null,
      }).onConflictDoUpdate({
        target: schema.repositories.nodeId,
        set: {
          description: repo.description,
          updatedAt: new Date(repo.updatedAt),
          pushedAt: new Date(repo.pushedAt),
          stargazerCount: repo.stargazerCount,
          language: repo.primaryLanguage?.name || null,
        },
      }).returning({ id: schema.repositories.id });

      const repoId = repoResult[0].id;
      stats.repos++;

      // Fetch branches
      try {
        const branchesData = await githubGraphQL<{
          repository: { refs: { nodes: BranchNode[] } }
        }>(BRANCHES_QUERY, { owner: username, name: repo.name });

        const branchNodes = branchesData.repository?.refs?.nodes || [];
        const branchMap: Record<string, number> = {};

        for (const branch of branchNodes) {
          const branchResult = await db.insert(schema.branches).values({
            name: branch.name,
            repositoryId: repoId,
            isDefault: branch.name === (repo.defaultBranchRef?.name || 'main'),
            createdAt: branch.target?.committedDate ? new Date(branch.target.committedDate) : null,
          }).onConflictDoNothing().returning({ id: schema.branches.id });

          if (branchResult.length > 0) {
            branchMap[branch.name] = branchResult[0].id;
            stats.branches++;
          } else {
            // Get existing branch id
            const existing = await db.select({ id: schema.branches.id })
              .from(schema.branches)
              .where(eq(schema.branches.name, branch.name))
              .limit(1);
            if (existing.length > 0) branchMap[branch.name] = existing[0].id;
          }
        }

        // Fetch commits from default branch
        const defaultBranch = repo.defaultBranchRef?.name || 'main';
        try {
          const commitsData = await githubGraphQL<{
            repository: { ref: { target: { history: { nodes: CommitNode[] } } } | null }
          }>(COMMITS_QUERY, { owner: username, name: repo.name, branch: `refs/heads/${defaultBranch}` });

          const commitNodes = commitsData.repository?.ref?.target?.history?.nodes || [];

          for (const commit of commitNodes) {
            let userId: number | null = null;
            if (commit.author.user?.login) {
              userId = await getOrCreateUser(db, commit.author.user.login, commit.author.user.avatarUrl, commit.author.name);
              stats.users++;
            } else if (commit.author.name) {
              // Create a synthetic user for non-GitHub authors
              const syntheticLogin = commit.author.email || commit.author.name.replace(/\s+/g, '-').toLowerCase();
              userId = await getOrCreateUser(db, syntheticLogin, undefined, commit.author.name);
            }

            await db.insert(schema.commits).values({
              sha: commit.oid,
              message: commit.message.substring(0, 500),
              authorName: commit.author.name,
              authorEmail: commit.author.email,
              committedAt: new Date(commit.committedDate),
              repositoryId: repoId,
              branchId: branchMap[defaultBranch] || null,
              userId,
            }).onConflictDoNothing();

            stats.commits++;
          }
        } catch (e) {
          console.error(`Error fetching commits for ${repo.name}:`, e);
        }

        // Fetch pull requests
        try {
          const prsData = await githubGraphQL<{
            repository: { pullRequests: { nodes: PRNode[] } }
          }>(PRS_QUERY, { owner: username, name: repo.name });

          const prNodes = prsData.repository?.pullRequests?.nodes || [];

          for (const pr of prNodes) {
            let authorId: number | null = null;
            if (pr.author?.login) {
              authorId = await getOrCreateUser(db, pr.author.login, pr.author.avatarUrl);
            }

            const prResult = await db.insert(schema.pullRequests).values({
              nodeId: pr.id,
              number: pr.number,
              title: pr.title,
              state: pr.state,
              createdAt: new Date(pr.createdAt),
              mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
              closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
              additions: pr.additions,
              deletions: pr.deletions,
              headBranch: pr.headRefName,
              baseBranch: pr.baseRefName,
              repositoryId: repoId,
              authorId,
            }).onConflictDoUpdate({
              target: schema.pullRequests.nodeId,
              set: {
                state: pr.state,
                mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
                closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
                additions: pr.additions,
                deletions: pr.deletions,
              },
            }).returning({ id: schema.pullRequests.id });

            const prId = prResult[0].id;
            stats.prs++;

            // Create merge event if merged
            if (pr.mergedAt && pr.mergedBy) {
              const mergedById = await getOrCreateUser(db, pr.mergedBy.login, pr.mergedBy.avatarUrl);
              await db.insert(schema.mergeEvents).values({
                prId,
                mergedById,
                mergedAt: new Date(pr.mergedAt),
                repositoryId: repoId,
              }).onConflictDoNothing();
            }

            // Link commits to PRs
            for (const commitRef of pr.commits.nodes) {
              const commitRecord = await db.select({ id: schema.commits.id })
                .from(schema.commits)
                .where(eq(schema.commits.sha, commitRef.commit.oid))
                .limit(1);

              if (commitRecord.length > 0) {
                await db.insert(schema.commitPullRequests).values({
                  commitId: commitRecord[0].id,
                  pullRequestId: prId,
                }).onConflictDoNothing();
              }
            }
          }
        } catch (e) {
          console.error(`Error fetching PRs for ${repo.name}:`, e);
        }
      } catch (e) {
        console.error(`Error processing ${repo.name}:`, e);
      }
    }

    return NextResponse.json({
      success: true,
      stats,
      message: `Ingested data for ${username}`,
    });
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(serializeError(error), { status: 500 });
  }
}
