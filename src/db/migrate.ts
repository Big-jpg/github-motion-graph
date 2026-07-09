// src/db/migrate.ts
// Run with: npx drizzle-kit push
// This file provides a programmatic migration alternative
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function createTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS repositories (
      id SERIAL PRIMARY KEY,
      node_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT UNIQUE NOT NULL,
      description TEXT,
      url TEXT NOT NULL,
      default_branch TEXT,
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      pushed_at TIMESTAMP,
      stargazer_count INTEGER DEFAULT 0,
      language TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS branches (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      is_bot BOOLEAN DEFAULT FALSE,
      name TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS commits (
      id SERIAL PRIMARY KEY,
      sha TEXT UNIQUE NOT NULL,
      message TEXT,
      author_name TEXT,
      author_email TEXT,
      committed_at TIMESTAMP,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pull_requests (
      id SERIAL PRIMARY KEY,
      node_id TEXT UNIQUE NOT NULL,
      number INTEGER NOT NULL,
      title TEXT,
      state TEXT,
      created_at TIMESTAMP,
      merged_at TIMESTAMP,
      closed_at TIMESTAMP,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      head_branch TEXT,
      base_branch TEXT,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS merge_events (
      id SERIAL PRIMARY KEY,
      pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
      merged_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      merged_at TIMESTAMP,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS commit_pull_requests (
      id SERIAL PRIMARY KEY,
      commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
      pull_request_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE
    )
  `;

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_repo_full_name ON repositories(full_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_branch_repo ON branches(repository_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_login ON users(login)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_commit_repo ON commits(repository_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_commit_user ON commits(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_commit_sha ON commits(sha)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pr_repo ON pull_requests(repository_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pr_author ON pull_requests(author_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_merge_repo ON merge_events(repository_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_merge_pr ON merge_events(pr_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cpr_commit ON commit_pull_requests(commit_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cpr_pr ON commit_pull_requests(pull_request_id)`;
}
