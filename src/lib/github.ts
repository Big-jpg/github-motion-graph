// src/lib/github.ts

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

export async function githubGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN environment variable is required');

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as GraphQLResponse<T>;
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
  }

  return json.data;
}

// Queries
export const REPOS_QUERY = `
  query($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(first: 100, after: $cursor, isFork: false, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          nameWithOwner
          description
          url
          defaultBranchRef { name }
          createdAt
          updatedAt
          pushedAt
          stargazerCount
          primaryLanguage { name }
        }
      }
    }
  }
`;

export const BRANCHES_QUERY = `
  query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          target { ... on Commit { committedDate } }
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
              pageInfo { hasNextPage endCursor }
              nodes {
                oid
                message
                committedDate
                author {
                  name
                  email
                  user { login avatarUrl }
                }
                associatedPullRequests(first: 5) {
                  nodes { number }
                }
              }
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
      pullRequests(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
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
          author { login ... on User { avatarUrl } }
          mergedBy { login ... on User { avatarUrl } }
          commits(first: 100) {
            nodes {
              commit { oid }
            }
          }
        }
      }
    }
  }
`;

// Type definitions for GitHub API responses
export interface RepoNode {
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  defaultBranchRef: { name: string } | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  stargazerCount: number;
  primaryLanguage: { name: string } | null;
}

export interface BranchNode {
  name: string;
  target: { committedDate: string } | null;
}

export interface CommitNode {
  oid: string;
  message: string;
  committedDate: string;
  author: {
    name: string | null;
    email: string | null;
    user: { login: string; avatarUrl: string } | null;
  };
  associatedPullRequests: {
    nodes: Array<{ number: number }>;
  };
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
  author: { login: string; avatarUrl?: string } | null;
  mergedBy: { login: string; avatarUrl?: string } | null;
  commits: {
    nodes: Array<{ commit: { oid: string } }>;
  };
}
