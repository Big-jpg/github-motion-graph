// src/app/api/stats/route.ts
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { ensureTables } from '@/db/migrate';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  try {
    await ensureTables();
    const sql = neon(process.env.DATABASE_URL!);

    const [repoCount] = await sql`SELECT COUNT(*) as count FROM repositories`;
    const [branchCount] = await sql`SELECT COUNT(*) as count FROM branches`;
    const [commitCount] = await sql`SELECT COUNT(*) as count FROM commits`;
    const [prCount] = await sql`SELECT COUNT(*) as count FROM pull_requests`;
    const [userCount] = await sql`SELECT COUNT(*) as count FROM users`;
    const [mergeCount] = await sql`SELECT COUNT(*) as count FROM merge_events`;

    const [botCommits] = await sql`
      SELECT COUNT(*) as count FROM commits c
      INNER JOIN users u ON u.id = c.user_id
      WHERE u.is_bot = true
    `;

    const [humanCommits] = await sql`
      SELECT COUNT(*) as count FROM commits c
      INNER JOIN users u ON u.id = c.user_id
      WHERE u.is_bot = false
    `;

    const topContributors = await sql`
      SELECT u.login, u.is_bot, u.avatar_url, COUNT(c.id) as commit_count
      FROM users u
      INNER JOIN commits c ON c.user_id = u.id
      GROUP BY u.id, u.login, u.is_bot, u.avatar_url
      ORDER BY commit_count DESC
      LIMIT 10
    `;

    const repoActivity = await sql`
      WITH repo_commit_memberships AS (
        SELECT repository_id, commit_id
        FROM repository_commits
        UNION
        SELECT repository_id, id AS commit_id
        FROM commits
        WHERE repository_id IS NOT NULL
      )
      SELECT
        r.name,
        COUNT(DISTINCT memberships.commit_id) as commit_count,
        COUNT(DISTINCT pr.id) as pr_count
      FROM repositories r
      LEFT JOIN repo_commit_memberships memberships ON memberships.repository_id = r.id
      LEFT JOIN pull_requests pr ON pr.repository_id = r.id
      GROUP BY r.id, r.name
      ORDER BY commit_count DESC
      LIMIT 10
    `;

    return NextResponse.json({
      totals: {
        repositories: parseInt(repoCount.count),
        branches: parseInt(branchCount.count),
        commits: parseInt(commitCount.count),
        pullRequests: parseInt(prCount.count),
        users: parseInt(userCount.count),
        mergeEvents: parseInt(mergeCount.count),
      },
      collaboration: {
        botCommits: parseInt(botCommits.count),
        humanCommits: parseInt(humanCommits.count),
        ratio: parseInt(humanCommits.count) > 0
          ? (parseInt(botCommits.count) / parseInt(humanCommits.count)).toFixed(2)
          : '0',
      },
      topContributors,
      repoActivity,
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
