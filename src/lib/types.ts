// src/lib/types.ts

export interface GraphNode {
  id: string;
  type: 'repository' | 'branch' | 'commit' | 'pullRequest' | 'user';
  label: string;
  metadata: Record<string, unknown>;
  contributorType?: 'bot' | 'human' | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ForceGraphNode {
  id: string;
  type: GraphNode['type'];
  label: string;
  metadata: Record<string, unknown>;
  contributorType?: 'bot' | 'human' | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  color?: string;
  size?: number;
}

export interface ForceGraphLink {
  source: string;
  target: string;
  type: string;
  weight: number;
  color?: string;
}

export interface ForceGraphData {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
}

export interface Stats {
  totals: {
    repositories: number;
    branches: number;
    commits: number;
    pullRequests: number;
    users: number;
    mergeEvents: number;
  };
  collaboration: {
    botCommits: number;
    humanCommits: number;
    ratio: string;
  };
  topContributors: Array<{
    login: string;
    is_bot: boolean;
    avatar_url: string;
    commit_count: number;
  }>;
  repoActivity: Array<{
    name: string;
    commit_count: number;
    pr_count: number;
  }>;
}
// src/lib/types.ts

export interface GraphNode {
  id: string;
  type: 'repository' | 'branch' | 'commit' | 'pullRequest' | 'user';
  label: string;
  metadata: Record<string, unknown>;
  contributorType?: 'bot' | 'human' | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ForceGraphNode {
  id: string;
  type: GraphNode['type'];
  label: string;
  metadata: Record<string, unknown>;
  contributorType?: 'bot' | 'human' | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  color?: string;
  size?: number;
}

export interface ForceGraphLink {
  source: string;
  target: string;
  type: string;
  weight: number;
  color?: string;
}

export interface ForceGraphData {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
}

export interface Stats {
  totals: {
    repositories: number;
    branches: number;
    commits: number;
    pullRequests: number;
    users: number;
    mergeEvents: number;
  };
  collaboration: {
    botCommits: number;
    humanCommits: number;
    ratio: string;
  };
  topContributors: Array<{
    login: string;
    is_bot: boolean;
    avatar_url: string;
    commit_count: number;
  }>;
  repoActivity: Array<{
    name: string;
    commit_count: number;
    pr_count: number;
  }>;
}
