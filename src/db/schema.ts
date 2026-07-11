// src/db/schema.ts
import { pgTable, text, integer, boolean, timestamp, serial, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
});

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  nodeId: text('node_id').unique().notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').unique().notNull(),
  description: text('description'),
  url: text('url').notNull(),
  defaultBranch: text('default_branch'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
  pushedAt: timestamp('pushed_at'),
  stargazerCount: integer('stargazer_count').default(0),
  language: text('language'),
  ownerLogin: text('owner_login'),
  isFork: boolean('is_fork').default(false),
  isPrivate: boolean('is_private').default(false),
}, (table) => [
  index('idx_repo_full_name').on(table.fullName),
]);

export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at'),
}, (table) => [
  index('idx_branch_repo').on(table.repositoryId),
  uniqueIndex('branches_repository_name_unique').on(table.repositoryId, table.name),
]);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  login: text('login').unique().notNull(),
  avatarUrl: text('avatar_url'),
  isBot: boolean('is_bot').default(false),
  name: text('name'),
}, (table) => [
  index('idx_user_login').on(table.login),
]);

export const commits = pgTable('commits', {
  id: serial('id').primaryKey(),
  sha: text('sha').unique().notNull(),
  message: text('message'),
  authorName: text('author_name'),
  authorEmail: text('author_email'),
  committedAt: timestamp('committed_at'),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  index('idx_commit_repo').on(table.repositoryId),
  index('idx_commit_user').on(table.userId),
  index('idx_commit_sha').on(table.sha),
]);

export const pullRequests = pgTable('pull_requests', {
  id: serial('id').primaryKey(),
  nodeId: text('node_id').unique().notNull(),
  number: integer('number').notNull(),
  title: text('title'),
  state: text('state'),
  createdAt: timestamp('created_at'),
  mergedAt: timestamp('merged_at'),
  closedAt: timestamp('closed_at'),
  additions: integer('additions').default(0),
  deletions: integer('deletions').default(0),
  headBranch: text('head_branch'),
  headRepositoryFullName: text('head_repository_full_name'),
  baseBranch: text('base_branch'),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  index('idx_pr_repo').on(table.repositoryId),
  index('idx_pr_author').on(table.authorId),
]);

export const mergeEvents = pgTable('merge_events', {
  id: serial('id').primaryKey(),
  prId: integer('pr_id').notNull().references(() => pullRequests.id, { onDelete: 'cascade' }),
  mergedById: integer('merged_by_id').references(() => users.id, { onDelete: 'set null' }),
  mergedAt: timestamp('merged_at'),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_merge_repo').on(table.repositoryId),
  index('idx_merge_pr').on(table.prId),
  uniqueIndex('merge_events_pr_unique').on(table.prId),
]);

export const commitPullRequests = pgTable('commit_pull_requests', {
  id: serial('id').primaryKey(),
  commitId: integer('commit_id').notNull().references(() => commits.id, { onDelete: 'cascade' }),
  pullRequestId: integer('pull_request_id').notNull().references(() => pullRequests.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_cpr_commit').on(table.commitId),
  index('idx_cpr_pr').on(table.pullRequestId),
  uniqueIndex('commit_pull_requests_commit_pr_unique').on(table.commitId, table.pullRequestId),
]);

// A Git commit object can be reachable from many repositories (especially forks)
// and many branches. Keep the legacy repositoryId/branchId columns on commits
// during the transition, while these junctions provide the lossless model.
export const repositoryCommits = pgTable('repository_commits', {
  id: serial('id').primaryKey(),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  commitId: integer('commit_id').notNull().references(() => commits.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_repository_commits_repository').on(table.repositoryId),
  index('idx_repository_commits_commit').on(table.commitId),
  uniqueIndex('repository_commits_repository_commit_unique').on(table.repositoryId, table.commitId),
]);

export const branchCommits = pgTable('branch_commits', {
  id: serial('id').primaryKey(),
  branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  commitId: integer('commit_id').notNull().references(() => commits.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_branch_commits_branch').on(table.branchId),
  index('idx_branch_commits_commit').on(table.commitId),
  uniqueIndex('branch_commits_branch_commit_unique').on(table.branchId, table.commitId),
]);
