// src/lib/github.ts

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30_000;

interface GraphQLErrorPayload {
  message: string;
  type?: string;
  extensions?: { type?: string; code?: string };
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLErrorPayload[];
  message?: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface GitHubConnection<T> {
  nodes: Array<T | null> | null;
  pageInfo: PageInfo;
  totalCount?: number;
}

export interface GitHubPage<T> {
  nodes: T[];
  pageInfo: PageInfo;
  pageNumber: number;
  totalCount: number | null;
}

export class GitHubApiError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly graphQLErrors?: GraphQLErrorPayload[];

  constructor(
    message: string,
    options: {
      status?: number;
      retryAfterMs?: number;
      graphQLErrors?: GraphQLErrorPayload[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'GitHubApiError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.graphQLErrors = options.graphQLErrors;
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function retryDelayFromHeaders(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) return Math.max(0, retryDate - Date.now());
  }

  if (headers.get('x-ratelimit-remaining') === '0') {
    const resetAt = Number.parseInt(headers.get('x-ratelimit-reset') || '', 10);
    if (Number.isFinite(resetAt)) return Math.max(0, resetAt * 1_000 - Date.now());
  }

  return undefined;
}

function isRetryableStatus(status: number, headers: Headers): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    (status === 403 &&
      (headers.has('retry-after') || headers.get('x-ratelimit-remaining') === '0'))
  );
}

function isRetryableGraphQLError(errors: GraphQLErrorPayload[], headers: Headers): boolean {
  if (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')) return true;

  return errors.some((error) => {
    const category = `${error.type || ''} ${error.extensions?.type || ''} ${error.extensions?.code || ''}`;
    const message = `${category} ${error.message}`;
    return /rate.?limit|secondary.?rate|abuse|timeout|timed.?out|internal|service.?unavailable|something.?went.?wrong/i.test(
      message,
    );
  });
}

function graphQLRetryDelay(errors: GraphQLErrorPayload[], headerDelay?: number): number | undefined {
  if (headerDelay !== undefined) return headerDelay;
  const message = errors.map((error) => error.message).join(' ');
  return /secondary.?rate|abuse/i.test(message) ? 60_000 : undefined;
}

function exponentialDelay(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.floor(Math.random() * 250);
}

async function waitForRetry(attempt: number, requestedDelay?: number): Promise<boolean> {
  const delay = requestedDelay ?? exponentialDelay(attempt);
  if (delay > MAX_RETRY_DELAY_MS) return false;
  await new Promise((resolve) => setTimeout(resolve, Math.max(delay, exponentialDelay(attempt))));
  return true;
}

function responseMessage<T>(json: GraphQLResponse<T> | null, fallback: string): string {
  if (json?.errors?.length) return json.errors.map((error) => error.message).join(', ');
  return json?.message || fallback;
}

export async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new GitHubApiError('GH_TOKEN environment variable is required');

  const timeoutMs = positiveInteger(process.env.GH_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const maxRetries = positiveInteger(process.env.GH_MAX_RETRIES, DEFAULT_MAX_RETRIES);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'github-motion-graph',
        },
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
        signal: controller.signal,
      });

      const text = await response.text();
      let json: GraphQLResponse<T> | null = null;
      if (text) {
        try {
          json = JSON.parse(text) as GraphQLResponse<T>;
        } catch {
          json = null;
        }
      }

      const retryAfterMs = retryDelayFromHeaders(response.headers);
      if (!response.ok) {
        const message = responseMessage(json, `${response.status} ${response.statusText}`);
        if (
          attempt < maxRetries &&
          isRetryableStatus(response.status, response.headers) &&
          (await waitForRetry(attempt, retryAfterMs))
        ) {
          continue;
        }
        throw new GitHubApiError(`GitHub API error: ${message}`, {
          status: response.status,
          retryAfterMs,
          graphQLErrors: json?.errors,
        });
      }

      if (json?.errors?.length) {
        const graphQLDelay = graphQLRetryDelay(json.errors, retryAfterMs);
        if (
          attempt < maxRetries &&
          isRetryableGraphQLError(json.errors, response.headers) &&
          (await waitForRetry(attempt, graphQLDelay))
        ) {
          continue;
        }
        throw new GitHubApiError(
          `GitHub GraphQL errors: ${json.errors.map((error) => error.message).join(', ')}`,
          { status: response.status, retryAfterMs: graphQLDelay, graphQLErrors: json.errors },
        );
      }

      if (!json?.data) {
        throw new GitHubApiError('GitHub GraphQL response did not include data', {
          status: response.status,
        });
      }

      return json.data;
    } catch (error) {
      if (error instanceof GitHubApiError) throw error;

      const retryable =
        error instanceof Error &&
        (error.name === 'AbortError' || error instanceof TypeError || /network|fetch/i.test(error.message));
      if (retryable && attempt < maxRetries && (await waitForRetry(attempt))) continue;

      const message =
        error instanceof Error && error.name === 'AbortError'
          ? `GitHub request timed out after ${timeoutMs}ms`
          : `GitHub request failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      throw new GitHubApiError(message, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new GitHubApiError('GitHub request exhausted its retry budget');
}

export async function* githubGraphQLPages<TData, TNode>(
  query: string,
  variables: Record<string, unknown>,
  selectConnection: (data: TData) => GitHubConnection<TNode> | null | undefined,
  initialCursor: string | null = null,
): AsyncGenerator<GitHubPage<TNode>> {
  let cursor: string | null = initialCursor;
  let pageNumber = 0;
  const seenCursors = new Set<string>();
  if (initialCursor) seenCursors.add(initialCursor);

  do {
    const data = await githubGraphQL<TData>(query, { ...variables, cursor });
    const connection = selectConnection(data);
    if (!connection) throw new GitHubApiError('GitHub connection was not available');

    pageNumber++;
    const nodes = (connection.nodes || []).filter((node): node is TNode => node !== null);
    yield {
      nodes,
      pageInfo: connection.pageInfo,
      pageNumber,
      totalCount: connection.totalCount ?? null,
    };

    if (!connection.pageInfo.hasNextPage) return;
    const nextCursor = connection.pageInfo.endCursor;
    if (!nextCursor) {
      throw new GitHubApiError('GitHub reported another page without an end cursor');
    }
    if (seenCursors.has(nextCursor)) {
      throw new GitHubApiError('GitHub pagination cursor repeated before completion');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (true);
}

const COMMIT_FIELDS = `
  oid
  message
  committedDate
  author {
    name
    email
    user { login avatarUrl }
  }
`;

export const VIEWER_QUERY = `
  query {
    viewer { login }
  }
`;

export const REPOS_QUERY = `
  query(
    $cursor: String,
    $affiliations: [RepositoryAffiliation!],
    $isFork: Boolean,
    $privacy: RepositoryPrivacy
  ) {
    viewer {
      repositories(
        first: 100,
        after: $cursor,
        affiliations: $affiliations,
        isFork: $isFork,
        privacy: $privacy,
        orderBy: {field: PUSHED_AT, direction: DESC}
      ) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          nameWithOwner
          owner { login }
          description
          url
          defaultBranchRef { name }
          createdAt
          updatedAt
          pushedAt
          stargazerCount
          primaryLanguage { name }
          isFork
          isPrivate
        }
      }
    }
  }
`;

export const BRANCHES_QUERY = `
  query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          target { ... on Commit { oid committedDate } }
        }
      }
    }
  }
`;

export const COMMITS_QUERY = `
  query($owner: String!, $name: String!, $branch: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $branch) {
        target {
          ... on Commit {
            history(first: 100, after: $cursor) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes { ${COMMIT_FIELDS} }
            }
          }
        }
      }
    }
  }
`;

export const PRS_QUERY = `
  query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 50, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          number
          title
          state
          createdAt
          mergedAt
          closedAt
          additions
          deletions
          headRefName
          baseRefName
          headRepository { nameWithOwner }
          author { login avatarUrl }
          mergedBy { login avatarUrl }
          commits(first: 50) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { commit { ${COMMIT_FIELDS} } }
          }
        }
      }
    }
  }
`;

export const PR_COMMITS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        commits(first: 100, after: $cursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { commit { ${COMMIT_FIELDS} } }
        }
      }
    }
  }
`;

export interface RepoNode {
  id: string;
  name: string;
  nameWithOwner: string;
  owner: { login: string };
  description: string | null;
  url: string;
  defaultBranchRef: { name: string } | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  stargazerCount: number;
  primaryLanguage: { name: string } | null;
  isFork: boolean;
  isPrivate: boolean;
}

export interface BranchNode {
  name: string;
  target: { oid?: string; committedDate?: string } | null;
}

export interface CommitNode {
  oid: string;
  message: string;
  committedDate: string;
  author: {
    name: string | null;
    email: string | null;
    user: { login: string; avatarUrl: string } | null;
  } | null;
}

export interface PRNode {
  id: string;
  number: number;
  title: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  headRepository: { nameWithOwner: string } | null;
  author: { login: string; avatarUrl: string } | null;
  mergedBy: { login: string; avatarUrl: string } | null;
  commits: GitHubConnection<PullRequestCommitNode>;
}

export interface PullRequestCommitNode {
  commit: CommitNode;
}
