// src/db/migrate.ts
// Run with: npx drizzle-kit push
// This file provides a programmatic migration alternative
import { neon } from '@neondatabase/serverless';

const CURRENT_SCHEMA_VERSION = '2026-07-11-lossless-github-graph-v3';

let schemaReadyPromise: Promise<void> | null = null;

export function ensureTables(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = createTables().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

export async function createTables() {
  const sql = neon(process.env.DATABASE_URL!);

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  const completedMigration = await sql`
    SELECT version
    FROM schema_migrations
    WHERE version = ${CURRENT_SCHEMA_VERSION}
    LIMIT 1
  `;
  if (completedMigration.length > 0) return;

  // This completion marker deliberately gates the expensive repair/backfill
  // work without pretending to be a distributed lock. The first invocation is
  // idempotent, but deployments must serialize that first migration: concurrent
  // first-run ingests can contend while both observe an absent marker.
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
      language TEXT,
      owner_login TEXT,
      is_fork BOOLEAN DEFAULT FALSE,
      is_private BOOLEAN DEFAULT FALSE
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
      head_repository_full_name TEXT,
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

  await sql`
    CREATE TABLE IF NOT EXISTS repository_commits (
      id SERIAL PRIMARY KEY,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS branch_commits (
      id SERIAL PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE
    )
  `;

  // Repair older partially-created tables. CREATE TABLE IF NOT EXISTS will not
  // add columns when a table already exists with an earlier shape.
  await sql`
    DO $$
    DECLARE
      table_name TEXT;
      sequence_name TEXT;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'repositories',
        'branches',
        'users',
        'commits',
        'pull_requests',
        'merge_events',
        'commit_pull_requests',
        'repository_commits',
        'branch_commits'
      ]
      LOOP
        sequence_name := table_name || '_id_seq';
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS id INTEGER', table_name);
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', sequence_name);
        EXECUTE format('ALTER SEQUENCE %I OWNED BY %I.id', sequence_name, table_name);
        EXECUTE format('UPDATE %I SET id = nextval(%L) WHERE id IS NULL', table_name, sequence_name);
        EXECUTE format(
          'SELECT setval(%L, GREATEST(COALESCE((SELECT MAX(id) FROM %I), 0), 1), true)',
          sequence_name,
          table_name
        );
        EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT nextval(%L)', table_name, sequence_name);
      END LOOP;
    END $$;
  `;

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
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS owner_login TEXT`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS is_fork BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE repositories ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE`;

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
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS head_repository_full_name TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS base_branch TEXT`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS repository_id INTEGER`;
  await sql`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS author_id INTEGER`;

  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS pr_id INTEGER`;
  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS merged_by_id INTEGER`;
  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP`;
  await sql`ALTER TABLE merge_events ADD COLUMN IF NOT EXISTS repository_id INTEGER`;

  await sql`ALTER TABLE commit_pull_requests ADD COLUMN IF NOT EXISTS commit_id INTEGER`;
  await sql`ALTER TABLE commit_pull_requests ADD COLUMN IF NOT EXISTS pull_request_id INTEGER`;

  await sql`ALTER TABLE repository_commits ADD COLUMN IF NOT EXISTS repository_id INTEGER`;
  await sql`ALTER TABLE repository_commits ADD COLUMN IF NOT EXISTS commit_id INTEGER`;

  await sql`ALTER TABLE branch_commits ADD COLUMN IF NOT EXISTS branch_id INTEGER`;
  await sql`ALTER TABLE branch_commits ADD COLUMN IF NOT EXISTS commit_id INTEGER`;

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

  await sql`
    DO $$
    DECLARE
      column_record RECORD;
      expected_columns TEXT[];
      table_record RECORD;
    BEGIN
      FOR table_record IN
        SELECT *
        FROM (
          VALUES
            ('repositories', ARRAY[
              'id',
              'node_id',
              'name',
              'full_name',
              'description',
              'url',
              'default_branch',
              'created_at',
              'updated_at',
              'pushed_at',
              'stargazer_count',
              'language',
              'owner_login',
              'is_fork',
              'is_private'
            ]::TEXT[]),
            ('branches', ARRAY[
              'id',
              'name',
              'repository_id',
              'is_default',
              'created_at'
            ]::TEXT[]),
            ('users', ARRAY[
              'id',
              'login',
              'avatar_url',
              'is_bot',
              'name'
            ]::TEXT[]),
            ('commits', ARRAY[
              'id',
              'sha',
              'message',
              'author_name',
              'author_email',
              'committed_at',
              'repository_id',
              'branch_id',
              'user_id'
            ]::TEXT[]),
            ('pull_requests', ARRAY[
              'id',
              'node_id',
              'number',
              'title',
              'state',
              'created_at',
              'merged_at',
              'closed_at',
              'additions',
              'deletions',
              'head_branch',
              'head_repository_full_name',
              'base_branch',
              'repository_id',
              'author_id'
            ]::TEXT[]),
            ('merge_events', ARRAY[
              'id',
              'pr_id',
              'merged_by_id',
              'merged_at',
              'repository_id'
            ]::TEXT[]),
            ('commit_pull_requests', ARRAY[
              'id',
              'commit_id',
              'pull_request_id'
            ]::TEXT[]),
            ('repository_commits', ARRAY[
              'id',
              'repository_id',
              'commit_id'
            ]::TEXT[]),
            ('branch_commits', ARRAY[
              'id',
              'branch_id',
              'commit_id'
            ]::TEXT[])
        ) AS table_columns(table_name, columns)
      LOOP
        expected_columns := table_record.columns;
        FOR column_record IN
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = table_record.table_name
            AND is_nullable = 'NO'
            AND column_name <> ALL(expected_columns)
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL',
            table_record.table_name,
            column_record.column_name
          );
        END LOOP;
      END LOOP;
    END $$;
  `;

  // Preserve stable branch ids while collapsing duplicates created before a
  // repository/name key existed. Repoint both legacy and junction references
  // before deleting duplicate branch rows.
  await sql`
    WITH branch_groups AS (
      SELECT
        repository_id,
        name,
        MIN(id) AS keep_id,
        BOOL_OR(COALESCE(is_default, FALSE)) AS is_default,
        MAX(created_at) AS created_at
      FROM branches
      WHERE repository_id IS NOT NULL AND name IS NOT NULL
      GROUP BY repository_id, name
    )
    UPDATE branches b
    SET
      is_default = groups.is_default,
      created_at = COALESCE(groups.created_at, b.created_at)
    FROM branch_groups groups
    WHERE b.id = groups.keep_id
  `;

  await sql`
    WITH branch_targets AS (
      SELECT
        id,
        MIN(id) OVER (PARTITION BY repository_id, name) AS keep_id
      FROM branches
      WHERE repository_id IS NOT NULL AND name IS NOT NULL
    ), ranked_memberships AS (
      SELECT
        bc.id,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(bt.keep_id, bc.branch_id), bc.commit_id
          ORDER BY bc.id
        ) AS row_number
      FROM branch_commits bc
      LEFT JOIN branch_targets bt ON bt.id = bc.branch_id
      WHERE bc.branch_id IS NOT NULL AND bc.commit_id IS NOT NULL
    )
    DELETE FROM branch_commits bc
    USING ranked_memberships ranked
    WHERE bc.id = ranked.id AND ranked.row_number > 1
  `;

  await sql`
    WITH branch_targets AS (
      SELECT
        id,
        MIN(id) OVER (PARTITION BY repository_id, name) AS keep_id
      FROM branches
      WHERE repository_id IS NOT NULL AND name IS NOT NULL
    )
    UPDATE commits c
    SET branch_id = targets.keep_id
    FROM branch_targets targets
    WHERE c.branch_id = targets.id AND targets.id <> targets.keep_id
  `;

  await sql`
    WITH branch_targets AS (
      SELECT
        id,
        MIN(id) OVER (PARTITION BY repository_id, name) AS keep_id
      FROM branches
      WHERE repository_id IS NOT NULL AND name IS NOT NULL
    )
    UPDATE branch_commits bc
    SET branch_id = targets.keep_id
    FROM branch_targets targets
    WHERE bc.branch_id = targets.id AND targets.id <> targets.keep_id
  `;

  await sql`
    WITH branch_targets AS (
      SELECT
        id,
        MIN(id) OVER (PARTITION BY repository_id, name) AS keep_id
      FROM branches
      WHERE repository_id IS NOT NULL AND name IS NOT NULL
    )
    DELETE FROM branches b
    USING branch_targets targets
    WHERE b.id = targets.id AND targets.id <> targets.keep_id
  `;

  // Older ingests used ON CONFLICT DO NOTHING without the corresponding
  // constraints, so remove already-created duplicate relationship rows first.
  await sql`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY pr_id ORDER BY id DESC) AS row_number
      FROM merge_events
      WHERE pr_id IS NOT NULL
    )
    DELETE FROM merge_events me
    USING ranked
    WHERE me.id = ranked.id AND ranked.row_number > 1
  `;

  await sql`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY commit_id, pull_request_id ORDER BY id) AS row_number
      FROM commit_pull_requests
      WHERE commit_id IS NOT NULL AND pull_request_id IS NOT NULL
    )
    DELETE FROM commit_pull_requests cpr
    USING ranked
    WHERE cpr.id = ranked.id AND ranked.row_number > 1
  `;

  await sql`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY repository_id, commit_id ORDER BY id) AS row_number
      FROM repository_commits
      WHERE repository_id IS NOT NULL AND commit_id IS NOT NULL
    )
    DELETE FROM repository_commits rc
    USING ranked
    WHERE rc.id = ranked.id AND ranked.row_number > 1
  `;

  await sql`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY branch_id, commit_id ORDER BY id) AS row_number
      FROM branch_commits
      WHERE branch_id IS NOT NULL AND commit_id IS NOT NULL
    )
    DELETE FROM branch_commits bc
    USING ranked
    WHERE bc.id = ranked.id AND ranked.row_number > 1
  `;

  await sql`
    UPDATE repositories
    SET owner_login = split_part(full_name, '/', 1)
    WHERE owner_login IS NULL AND position('/' IN full_name) > 0
  `;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS repositories_node_id_unique ON repositories(node_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS repositories_full_name_unique ON repositories(full_name)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_login_unique ON users(login)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS commits_sha_unique ON commits(sha)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS pull_requests_node_id_unique ON pull_requests(node_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS branches_repository_name_unique ON branches(repository_id, name)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS merge_events_pr_unique ON merge_events(pr_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS commit_pull_requests_commit_pr_unique ON commit_pull_requests(commit_id, pull_request_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS repository_commits_repository_commit_unique ON repository_commits(repository_id, commit_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS branch_commits_branch_commit_unique ON branch_commits(branch_id, commit_id)`;

  // Backfill the additive many-to-many model from legacy commit ownership.
  await sql`
    INSERT INTO repository_commits (repository_id, commit_id)
    SELECT repository_id, id
    FROM commits
    WHERE repository_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `;

  await sql`
    INSERT INTO repository_commits (repository_id, commit_id)
    SELECT b.repository_id, c.id
    FROM commits c
    INNER JOIN branches b ON b.id = c.branch_id
    WHERE b.repository_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `;

  await sql`
    INSERT INTO branch_commits (branch_id, commit_id)
    SELECT branch_id, id
    FROM commits
    WHERE branch_id IS NOT NULL
    ON CONFLICT DO NOTHING
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
  await sql`CREATE INDEX IF NOT EXISTS idx_repository_commits_repository ON repository_commits(repository_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_repository_commits_commit ON repository_commits(commit_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_branch_commits_branch ON branch_commits(branch_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_branch_commits_commit ON branch_commits(commit_id)`;

  await sql`
    INSERT INTO schema_migrations (version)
    VALUES (${CURRENT_SCHEMA_VERSION})
    ON CONFLICT (version) DO NOTHING
  `;
}
