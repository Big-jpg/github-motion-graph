// src/app/api/graph/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import type { GraphEdge, GraphNode, GraphResponseMeta } from '@/lib/types';

export const runtime = 'edge';

const MAX_EXPLICIT_GRAPH_LIMIT = 50_000;

class InvalidLimitError extends Error {
  constructor(public readonly parameter: string) {
    super(`${parameter} must be a positive integer no greater than ${MAX_EXPLICIT_GRAPH_LIMIT}`);
  }
}

function parseOptionalLimit(value: string | null, parameter: string): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new InvalidLimitError(parameter);

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_EXPLICIT_GRAPH_LIMIT) {
    throw new InvalidLimitError(parameter);
  }

  return parsed;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function branchKey(repositoryId: unknown, name: unknown): string {
  return `${String(repositoryId)}\u0000${String(name)}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoFilter = searchParams.get('repo')?.trim() || null;
  const userFilter = searchParams.get('user')?.trim() || null;

  let commitLimit: number | null;
  let prLimit: number | null;

  try {
    commitLimit = parseOptionalLimit(searchParams.get('commitLimit'), 'commitLimit');
    prLimit = parseOptionalLimit(searchParams.get('prLimit'), 'prLimit');
  } catch (error) {
    if (error instanceof InvalidLimitError) {
      return NextResponse.json(
        { error: error.message, nodes: [], edges: [] },
        { status: 400 },
      );
    }
    throw error;
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const repositoryColumns = sql`
      SELECT
        id,
        name,
        full_name,
        description,
        url,
        language,
        stargazer_count,
        default_branch,
        owner_login,
        is_fork,
        is_private
      FROM repositories
    `;

    let repos;
    if (repoFilter) {
      const fullNameMatches = await sql`
        ${repositoryColumns}
        WHERE LOWER(full_name) = LOWER(${repoFilter})
        ORDER BY pushed_at DESC NULLS LAST
      `;

      if (fullNameMatches.length > 0) {
        repos = fullNameMatches;
      } else {
        const nameMatches = await sql`
          ${repositoryColumns}
          WHERE LOWER(name) = LOWER(${repoFilter})
          ORDER BY pushed_at DESC NULLS LAST
        `;

        if (nameMatches.length > 1) {
          return NextResponse.json(
            {
              error: `Repository name "${repoFilter}" is ambiguous; use the full owner/name value`,
              candidates: nameMatches.map(repo => repo.full_name),
              nodes: [],
              edges: [],
            },
            { status: 409 },
          );
        }

        repos = nameMatches;
      }
    } else {
      repos = await sql`
        ${repositoryColumns}
        ORDER BY pushed_at DESC NULLS LAST
      `;
    }

    const repoIds = repos.map(repo => repo.id);
    if (repoIds.length === 0) {
      const meta: GraphResponseMeta = {
        filters: { repo: repoFilter, user: userFilter },
        limits: { commits: commitLimit, pullRequests: prLimit },
        totals: { repositories: 0, branches: 0, commits: 0, pullRequests: 0, users: 0 },
        returned: { repositories: 0, branches: 0, commits: 0, pullRequests: 0, users: 0 },
        complete: { commits: true, pullRequests: true },
      };
      return NextResponse.json({ nodes: [], edges: [], meta });
    }

    let filteredUserId: unknown = null;
    if (userFilter) {
      const filteredUsers = await sql`
        SELECT id
        FROM users
        WHERE LOWER(login) = LOWER(${userFilter})
        LIMIT 1
      `;
      filteredUserId = filteredUsers[0]?.id ?? null;
    }

    const commitUserCondition = userFilter
      ? filteredUserId === null
        ? sql`AND FALSE`
        : sql`AND c.user_id = ${filteredUserId}`
      : sql``;
    const prUserCondition = userFilter
      ? filteredUserId === null
        ? sql`AND FALSE`
        : sql`AND (
            pr.author_id = ${filteredUserId}
            OR EXISTS (
              SELECT 1
              FROM merge_events filtered_me
              WHERE filtered_me.pr_id = pr.id
                AND filtered_me.merged_by_id = ${filteredUserId}
            )
          )`
      : sql``;

    const [branchesQuery, commitsQuery, prsQuery] = await Promise.all([
      sql`
        SELECT b.id, b.name, b.repository_id, b.is_default
        FROM branches b
        WHERE b.repository_id = ANY(${repoIds})
        ORDER BY b.is_default DESC, b.name ASC
      `,
      sql`
        WITH scoped_commits AS (
          SELECT
            c.id,
            c.sha,
            c.message,
            c.author_name,
            c.committed_at,
            c.repository_id AS legacy_repository_id,
            c.branch_id AS legacy_branch_id,
            c.user_id
          FROM commits c
          WHERE (
            EXISTS (
              SELECT 1
              FROM repository_commits rc
              WHERE rc.commit_id = c.id AND rc.repository_id = ANY(${repoIds})
            )
            OR c.repository_id = ANY(${repoIds})
          )
          ${commitUserCondition}
        )
        SELECT scoped_commits.*, COUNT(*) OVER() AS total_count
        FROM scoped_commits
        ORDER BY committed_at DESC NULLS LAST, id DESC
        ${commitLimit === null ? sql`` : sql`LIMIT ${commitLimit}`}
      `,
      sql`
        WITH scoped_prs AS (
          SELECT
            pr.id,
            pr.number,
            pr.title,
            pr.state,
            pr.created_at,
            pr.merged_at,
            pr.additions,
            pr.deletions,
            pr.head_branch,
            pr.head_repository_full_name,
            pr.base_branch,
            pr.repository_id,
            pr.author_id
          FROM pull_requests pr
          WHERE pr.repository_id = ANY(${repoIds})
          ${prUserCondition}
        )
        SELECT scoped_prs.*, COUNT(*) OVER() AS total_count
        FROM scoped_prs
        ORDER BY created_at DESC NULLS LAST, id DESC
        ${prLimit === null ? sql`` : sql`LIMIT ${prLimit}`}
      `,
    ]);

    const commitIds = commitsQuery.map(commit => commit.id);
    const prIds = prsQuery.map(pr => pr.id);

    const [branchMemberships, mergeEventsQuery, commitPrLinks] = await Promise.all([
      commitIds.length > 0
        ? sql`
            SELECT bc.commit_id, bc.branch_id
            FROM branch_commits bc
            INNER JOIN branches b ON b.id = bc.branch_id
            WHERE bc.commit_id = ANY(${commitIds})
              AND b.repository_id = ANY(${repoIds})
          `
        : Promise.resolve([]),
      prIds.length > 0
        ? sql`
            SELECT me.pr_id, me.merged_by_id, me.merged_at, me.repository_id
            FROM merge_events me
            WHERE me.pr_id = ANY(${prIds})
          `
        : Promise.resolve([]),
      commitIds.length > 0 && prIds.length > 0
        ? sql`
            SELECT cpr.commit_id, cpr.pull_request_id
            FROM commit_pull_requests cpr
            WHERE cpr.commit_id = ANY(${commitIds})
              AND cpr.pull_request_id = ANY(${prIds})
          `
        : Promise.resolve([]),
    ]);

    const visibleUserIds = new Set<unknown>();
    for (const commit of commitsQuery) {
      if (commit.user_id !== null) visibleUserIds.add(commit.user_id);
    }
    for (const pr of prsQuery) {
      if (pr.author_id !== null) visibleUserIds.add(pr.author_id);
    }
    for (const mergeEvent of mergeEventsQuery) {
      if (mergeEvent.merged_by_id !== null) visibleUserIds.add(mergeEvent.merged_by_id);
    }

    const usersQuery = visibleUserIds.size > 0
      ? await sql`
          SELECT u.id, u.login, u.avatar_url, u.is_bot, u.name
          FROM users u
          WHERE u.id = ANY(${Array.from(visibleUserIds)})
          ORDER BY u.login ASC
        `
      : [];

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const addEdge = (edge: GraphEdge) => {
      const key = `${edge.source}\u0000${edge.type}\u0000${edge.target}`;
      if (edgeIds.has(key)) return;
      edgeIds.add(key);
      edges.push(edge);
    };

    const repositoryIdsByFullName = new Map<string, unknown>();
    for (const repo of repos) {
      const nodeId = `repo:${repo.id}`;
      repositoryIdsByFullName.set(String(repo.full_name).toLowerCase(), repo.id);
      nodes.push({
        id: nodeId,
        type: 'repository',
        label: repo.name,
        metadata: {
          fullName: repo.full_name,
          ownerLogin: repo.owner_login,
          description: repo.description,
          url: repo.url,
          language: repo.language,
          stars: repo.stargazer_count,
          defaultBranch: repo.default_branch,
          isFork: repo.is_fork,
          isPrivate: repo.is_private,
        },
      });
      nodeIds.add(nodeId);
    }

    const branchIds = new Set<string>();
    const branchesByRepositoryAndName = new Map<string, unknown>();
    for (const branch of branchesQuery) {
      const nodeId = `branch:${branch.id}`;
      branchIds.add(String(branch.id));
      branchesByRepositoryAndName.set(branchKey(branch.repository_id, branch.name), branch.id);
      nodes.push({
        id: nodeId,
        type: 'branch',
        label: branch.name,
        metadata: {
          isDefault: branch.is_default,
          repositoryId: branch.repository_id,
        },
      });
      nodeIds.add(nodeId);
      addEdge({
        source: nodeId,
        target: `repo:${branch.repository_id}`,
        type: 'BELONGS_TO',
        weight: 1,
      });
    }

    const contributorTypeByUserId = new Map<string, 'bot' | 'human'>();
    for (const user of usersQuery) {
      const nodeId = `user:${user.id}`;
      const contributorType = user.is_bot ? 'bot' : 'human';
      contributorTypeByUserId.set(String(user.id), contributorType);
      nodes.push({
        id: nodeId,
        type: 'user',
        label: user.login,
        metadata: {
          avatarUrl: user.avatar_url,
          isBot: user.is_bot,
          name: user.name,
        },
        contributorType,
      });
      nodeIds.add(nodeId);
    }

    const branchIdsByCommitId = new Map<string, Set<string>>();
    for (const membership of branchMemberships) {
      const commitId = String(membership.commit_id);
      const memberships = branchIdsByCommitId.get(commitId) ?? new Set<string>();
      memberships.add(String(membership.branch_id));
      branchIdsByCommitId.set(commitId, memberships);
    }

    for (const commit of commitsQuery) {
      const nodeId = `commit:${commit.id}`;
      nodes.push({
        id: nodeId,
        type: 'commit',
        label: String(commit.sha).substring(0, 7),
        metadata: {
          message: commit.message ? String(commit.message).substring(0, 100) : null,
          authorName: commit.author_name,
          committedAt: commit.committed_at,
        },
        contributorType: commit.user_id
          ? contributorTypeByUserId.get(String(commit.user_id)) ?? null
          : null,
      });
      nodeIds.add(nodeId);

      const memberships = branchIdsByCommitId.get(String(commit.id)) ?? new Set<string>();
      if (commit.legacy_branch_id !== null && branchIds.has(String(commit.legacy_branch_id))) {
        memberships.add(String(commit.legacy_branch_id));
      }
      for (const branchId of memberships) {
        addEdge({
          source: nodeId,
          target: `branch:${branchId}`,
          type: 'BELONGS_TO',
          weight: 0.5,
        });
      }

      if (commit.user_id !== null) {
        const userNodeId = `user:${commit.user_id}`;
        if (nodeIds.has(userNodeId)) {
          addEdge({ source: userNodeId, target: nodeId, type: 'AUTHORED', weight: 1 });
        }
      }
    }

    for (const pr of prsQuery) {
      const nodeId = `pr:${pr.id}`;
      nodes.push({
        id: nodeId,
        type: 'pullRequest',
        label: `#${pr.number}`,
        metadata: {
          title: pr.title,
          state: pr.state,
          additions: pr.additions,
          deletions: pr.deletions,
          createdAt: pr.created_at,
          mergedAt: pr.merged_at,
          headRepositoryFullName: pr.head_repository_full_name,
        },
        contributorType: pr.author_id
          ? contributorTypeByUserId.get(String(pr.author_id)) ?? null
          : null,
      });
      nodeIds.add(nodeId);

      if (pr.author_id !== null) {
        const userNodeId = `user:${pr.author_id}`;
        if (nodeIds.has(userNodeId)) {
          addEdge({ source: userNodeId, target: nodeId, type: 'OPENED', weight: 2 });
        }
      }

      const baseBranchId = branchesByRepositoryAndName.get(branchKey(pr.repository_id, pr.base_branch));
      if (baseBranchId !== undefined) {
        addEdge({ source: nodeId, target: `branch:${baseBranchId}`, type: 'TARGETS', weight: 1.5 });
      }

      const knownHeadRepository =
        typeof pr.head_repository_full_name === 'string' && pr.head_repository_full_name.length > 0;
      const headRepositoryId = knownHeadRepository
        ? repositoryIdsByFullName.get(pr.head_repository_full_name.toLowerCase())
        : pr.repository_id;
      const headBranchId = headRepositoryId === undefined
        ? undefined
        : branchesByRepositoryAndName.get(branchKey(headRepositoryId, pr.head_branch));
      if (headBranchId !== undefined) {
        addEdge({ source: nodeId, target: `branch:${headBranchId}`, type: 'FROM', weight: 1 });
      }
    }

    for (const mergeEvent of mergeEventsQuery) {
      if (mergeEvent.merged_by_id === null) continue;
      const userNodeId = `user:${mergeEvent.merged_by_id}`;
      const prNodeId = `pr:${mergeEvent.pr_id}`;
      if (nodeIds.has(userNodeId) && nodeIds.has(prNodeId)) {
        addEdge({ source: userNodeId, target: prNodeId, type: 'MERGED', weight: 3 });
      }
    }

    for (const link of commitPrLinks) {
      const commitNodeId = `commit:${link.commit_id}`;
      const prNodeId = `pr:${link.pull_request_id}`;
      if (nodeIds.has(commitNodeId) && nodeIds.has(prNodeId)) {
        addEdge({ source: commitNodeId, target: prNodeId, type: 'PART_OF', weight: 1 });
      }
    }

    const commitTotal = commitsQuery.length > 0 ? toNumber(commitsQuery[0].total_count) : 0;
    const prTotal = prsQuery.length > 0 ? toNumber(prsQuery[0].total_count) : 0;
    const meta: GraphResponseMeta = {
      filters: { repo: repoFilter, user: userFilter },
      limits: { commits: commitLimit, pullRequests: prLimit },
      totals: {
        repositories: repos.length,
        branches: branchesQuery.length,
        commits: commitTotal,
        pullRequests: prTotal,
        users: usersQuery.length,
      },
      returned: {
        repositories: repos.length,
        branches: branchesQuery.length,
        commits: commitsQuery.length,
        pullRequests: prsQuery.length,
        users: usersQuery.length,
      },
      complete: {
        commits: commitsQuery.length >= commitTotal,
        pullRequests: prsQuery.length >= prTotal,
      },
    };

    return NextResponse.json({ nodes, edges, meta });
  } catch (error) {
    console.error('Graph API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', nodes: [], edges: [] },
      { status: 500 },
    );
  }
}
