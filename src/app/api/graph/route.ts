// src/app/api/graph/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'edge';

interface GraphNode {
  id: string;
  type: 'repository' | 'branch' | 'commit' | 'pullRequest' | 'user';
  label: string;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repoFilter = searchParams.get('repo');
  const userFilter = searchParams.get('user');
  const limitCommits = parseInt(searchParams.get('commitLimit') || '200');

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // Build repo filter condition
    let repoCondition = '';
    if (repoFilter) {
      repoCondition = `WHERE r.name = '${repoFilter.replace(/'/g, "''")}'`;
    }

    // Fetch repositories
    const repos = await sql`
      SELECT id, name, full_name, description, url, language, stargazer_count, default_branch
      FROM repositories
      ${repoFilter ? sql`WHERE name = ${repoFilter}` : sql``}
      ORDER BY pushed_at DESC
    `;

    const repoIds = repos.map(r => r.id);
    if (repoIds.length === 0) {
      return NextResponse.json({ nodes: [], edges: [] });
    }

    for (const repo of repos) {
      const nodeId = `repo:${repo.id}`;
      nodes.push({
        id: nodeId,
        type: 'repository',
        label: repo.name,
        metadata: {
          fullName: repo.full_name,
          description: repo.description,
          url: repo.url,
          language: repo.language,
          stars: repo.stargazer_count,
        },
      });
      nodeIds.add(nodeId);
    }

    // Fetch users
    let usersQuery;
    if (userFilter) {
      usersQuery = await sql`
        SELECT DISTINCT u.id, u.login, u.avatar_url, u.is_bot, u.name
        FROM users u
        WHERE u.login = ${userFilter}
      `;
    } else {
      usersQuery = await sql`
        SELECT DISTINCT u.id, u.login, u.avatar_url, u.is_bot, u.name
        FROM users u
        WHERE EXISTS (
          SELECT 1 FROM commits c WHERE c.user_id = u.id AND c.repository_id = ANY(${repoIds})
        ) OR EXISTS (
          SELECT 1 FROM pull_requests pr WHERE pr.author_id = u.id AND pr.repository_id = ANY(${repoIds})
        )
      `;
    }

    for (const user of usersQuery) {
      const nodeId = `user:${user.id}`;
      nodes.push({
        id: nodeId,
        type: 'user',
        label: user.login,
        metadata: {
          avatarUrl: user.avatar_url,
          isBot: user.is_bot,
          name: user.name,
        },
      });
      nodeIds.add(nodeId);
    }

    const userIds = usersQuery.map(u => u.id);

    // Fetch branches (limit to repos in scope)
    const branchesQuery = await sql`
      SELECT b.id, b.name, b.repository_id, b.is_default
      FROM branches b
      WHERE b.repository_id = ANY(${repoIds})
      ORDER BY b.is_default DESC
    `;

    for (const branch of branchesQuery) {
      const nodeId = `branch:${branch.id}`;
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

      // Branch → BELONGS_TO → Repository
      edges.push({
        source: nodeId,
        target: `repo:${branch.repository_id}`,
        type: 'BELONGS_TO',
        weight: 1,
      });
    }

    // Fetch commits (limited)
    let commitsQuery;
    if (userFilter && userIds.length > 0) {
      commitsQuery = await sql`
        SELECT c.id, c.sha, c.message, c.author_name, c.committed_at, c.repository_id, c.branch_id, c.user_id
        FROM commits c
        WHERE c.repository_id = ANY(${repoIds}) AND c.user_id = ANY(${userIds})
        ORDER BY c.committed_at DESC
        LIMIT ${limitCommits}
      `;
    } else {
      commitsQuery = await sql`
        SELECT c.id, c.sha, c.message, c.author_name, c.committed_at, c.repository_id, c.branch_id, c.user_id
        FROM commits c
        WHERE c.repository_id = ANY(${repoIds})
        ORDER BY c.committed_at DESC
        LIMIT ${limitCommits}
      `;
    }

    for (const commit of commitsQuery) {
      const nodeId = `commit:${commit.id}`;
      nodes.push({
        id: nodeId,
        type: 'commit',
        label: commit.sha.substring(0, 7),
        metadata: {
          message: commit.message?.substring(0, 100),
          authorName: commit.author_name,
          committedAt: commit.committed_at,
        },
      });
      nodeIds.add(nodeId);

      // Commit → BELONGS_TO → Branch
      if (commit.branch_id) {
        const branchNodeId = `branch:${commit.branch_id}`;
        if (nodeIds.has(branchNodeId)) {
          edges.push({
            source: nodeId,
            target: branchNodeId,
            type: 'BELONGS_TO',
            weight: 0.5,
          });
        }
      }

      // User → AUTHORED → Commit
      if (commit.user_id) {
        const userNodeId = `user:${commit.user_id}`;
        if (nodeIds.has(userNodeId)) {
          edges.push({
            source: userNodeId,
            target: nodeId,
            type: 'AUTHORED',
            weight: 1,
          });
        }
      }
    }

    // Fetch pull requests
    const prsQuery = await sql`
      SELECT pr.id, pr.number, pr.title, pr.state, pr.created_at, pr.merged_at, pr.additions, pr.deletions, pr.head_branch, pr.base_branch, pr.repository_id, pr.author_id
      FROM pull_requests pr
      WHERE pr.repository_id = ANY(${repoIds})
      ${userFilter && userIds.length > 0 ? sql`AND pr.author_id = ANY(${userIds})` : sql``}
      ORDER BY pr.created_at DESC
      LIMIT 200
    `;

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
        },
      });
      nodeIds.add(nodeId);

      // User → OPENED → PullRequest
      if (pr.author_id) {
        const userNodeId = `user:${pr.author_id}`;
        if (nodeIds.has(userNodeId)) {
          edges.push({
            source: userNodeId,
            target: nodeId,
            type: 'OPENED',
            weight: 2,
          });
        }
      }

      // PR → TARGETS → Branch (base)
      const baseBranchNode = branchesQuery.find(b => b.name === pr.base_branch && b.repository_id === pr.repository_id);
      if (baseBranchNode) {
        edges.push({
          source: nodeId,
          target: `branch:${baseBranchNode.id}`,
          type: 'TARGETS',
          weight: 1.5,
        });
      }

      // PR → FROM → Branch (head)
      const headBranchNode = branchesQuery.find(b => b.name === pr.head_branch && b.repository_id === pr.repository_id);
      if (headBranchNode) {
        edges.push({
          source: nodeId,
          target: `branch:${headBranchNode.id}`,
          type: 'FROM',
          weight: 1,
        });
      }
    }

    // Fetch merge events
    const mergeEventsQuery = await sql`
      SELECT me.pr_id, me.merged_by_id, me.merged_at, me.repository_id
      FROM merge_events me
      WHERE me.repository_id = ANY(${repoIds})
    `;

    for (const me of mergeEventsQuery) {
      if (me.merged_by_id) {
        const userNodeId = `user:${me.merged_by_id}`;
        const prNodeId = `pr:${me.pr_id}`;
        if (nodeIds.has(userNodeId) && nodeIds.has(prNodeId)) {
          edges.push({
            source: userNodeId,
            target: prNodeId,
            type: 'MERGED',
            weight: 3,
          });
        }
      }
    }

    // Fetch commit-PR links
    const commitPrLinks = await sql`
      SELECT cpr.commit_id, cpr.pull_request_id
      FROM commit_pull_requests cpr
      INNER JOIN commits c ON c.id = cpr.commit_id
      WHERE c.repository_id = ANY(${repoIds})
    `;

    for (const link of commitPrLinks) {
      const commitNodeId = `commit:${link.commit_id}`;
      const prNodeId = `pr:${link.pull_request_id}`;
      if (nodeIds.has(commitNodeId) && nodeIds.has(prNodeId)) {
        edges.push({
          source: commitNodeId,
          target: prNodeId,
          type: 'PART_OF',
          weight: 1,
        });
      }
    }

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error('Graph API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', nodes: [], edges: [] },
      { status: 500 }
    );
  }
}
