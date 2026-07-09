// src/db/migrate.ts
// Run with: npx drizzle-kit push
// This file provides a programmatic migration alternative
import { neon } from '@neondatabase/serverless';

export async function createTables() {
  const sql = neon(process.env.DATABASE_URL!);
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

  // Repair older partially-created tables. CREATE TABLE IF NOT EXISTS will not
  // add columns when a table already exists with an earlier shape.
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS node_id TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS full_name TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS description TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS url TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS default_branch TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS created_at TIMESTAMP`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMP`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS stargazer_count INTEGER DEFAULT 0`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS language TEXT`;

  await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS repository_id INTEGER`;
  await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_at TIMESTAMP`;

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS login TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`;

  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS sha TEXT`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS message TEXT`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS author_name TEXT`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS author_email TEXT`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS committed_at TIMESTAMP`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS repository_id INTEGER`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS branch_id INTEGER`;
  await sql`ALTER TABLE commits ADD COLUMN IF NOT EXISTS user_id INTEGER`;

  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS node_id TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS number INTEGER`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS title TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS state TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS additions INTEGER DEFAULT 0`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS deletions INTEGER DEFAULT 0`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS head_branch TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS base_branch TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS repository_id INTEGER`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS author_id INTEGER`;

  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS pr_id INTEGER`;
  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS merged_by_id INTEGER`;
  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP`;
  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS repository_id INTEGER`;

  await sql`ALTER TABLE commit_pull_requests ADD COLUMN IF NOT EXISTS commit_id INTEGER`;
  await sql`ALTER TABLE commit_pull_requests ADD COLUMN IF NOT EXISTS pull_request_id INTEGER`;

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'merge_events' AND column_name = 'pull_request_id'
      ) THEN
        EXECUTE 'UPDATE merge_events SET pr_id = pull_request_id WHERE pr_id IS NULL';
      END IF;
    END $$;
  `;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS repositories_node_id_unique ON repositories(node_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS repositories_full_name_unique ON repositories(full_name)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_login_unique ON users(login)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS commits_sha_unique ON commits(sha)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS pull_requests_node_id_unique ON pull_requests(node_id)`;

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
