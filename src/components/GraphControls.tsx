// src/components/GraphControls.tsx
'use client';

import { useState } from 'react';
import type { GraphData } from '@/lib/types';

const NODE_TYPES = [
  { key: 'repository', label: 'Repos', color: '#8b5cf6' },
  { key: 'branch', label: 'Branches', color: '#06b6d4' },
  { key: 'commit', label: 'Commits', color: '#6b7280' },
  { key: 'pullRequest', label: 'PRs', color: '#f59e0b' },
  { key: 'user', label: 'Users', color: '#10b981' },
];

const CONTRIBUTOR_TYPES = [
  { key: 'bot', label: 'AI/Bot', color: '#ec4899' },
  { key: 'human', label: 'Human', color: '#10b981' },
];

export interface GraphFilters {
  nodeTypes: Set<string>;
  repos: Set<string>;
  users: Set<string>;
  contributors: Set<string>; // 'bot' | 'human'
}

interface GraphControlsProps {
  data: GraphData;
  visibleNodeCount: number;
  visibleEdgeCount: number;
  onFilterChange: (filters: GraphFilters) => void;
}

export default function GraphControls({ data, visibleNodeCount, visibleEdgeCount, onFilterChange }: GraphControlsProps) {
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(NODE_TYPES.map(t => t.key))
  );
  const [activeContributors, setActiveContributors] = useState<Set<string>>(
    new Set(CONTRIBUTOR_TYPES.map(t => t.key))
  );
  const [expanded, setExpanded] = useState(false);

  const emitFilters = (types: Set<string>, contributors: Set<string>) => {
    onFilterChange({
      nodeTypes: types,
      repos: new Set(),
      users: new Set(),
      contributors,
    });
  };

  const toggleType = (type: string) => {
    const next = new Set(activeTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setActiveTypes(next);
    emitFilters(next, activeContributors);
  };

  const toggleContributor = (type: string) => {
    const next = new Set(activeContributors);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setActiveContributors(next);
    emitFilters(activeTypes, next);
  };

  // Count nodes by contributor type
  const botNodeCount = data.nodes.filter(n => n.contributorType === 'bot').length;
  const humanNodeCount = data.nodes.filter(n => n.contributorType === 'human').length;

  return (
    <div className="absolute bottom-4 left-4 z-10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="bg-zinc-900/90 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 hover:border-zinc-500 transition-colors backdrop-blur-sm"
      >
        {expanded ? '✕ Close' : '◉ Filters'}
      </button>

      {expanded && (
        <div className="mt-2 bg-zinc-900/95 border border-zinc-700 rounded-lg p-4 backdrop-blur-sm min-w-[220px]">
          <p className="text-xs font-mono text-zinc-500 uppercase mb-3">Node Types</p>
          <div className="space-y-2">
            {NODE_TYPES.map(({ key, label, color }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={activeTypes.has(key)}
                  onChange={() => toggleType(key)}
                  className="sr-only"
                />
                <span
                  className={`w-3 h-3 rounded-full border-2 transition-all ${
                    activeTypes.has(key) ? 'scale-100' : 'scale-75 opacity-30'
                  }`}
                  style={{
                    backgroundColor: activeTypes.has(key) ? color : 'transparent',
                    borderColor: color,
                  }}
                />
                <span className={`text-xs font-mono transition-opacity ${
                  activeTypes.has(key) ? 'text-zinc-200' : 'text-zinc-500'
                }`}>
                  {label}
                </span>
                <span className="text-xs text-zinc-600 ml-auto">
                  {data.nodes.filter(n => n.type === key).length}
                </span>
              </label>
            ))}
          </div>

          {/* Contributor filter */}
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <p className="text-xs font-mono text-zinc-500 uppercase mb-3">Contributors</p>
            <div className="space-y-2">
              {CONTRIBUTOR_TYPES.map(({ key, label, color }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={activeContributors.has(key)}
                    onChange={() => toggleContributor(key)}
                    className="sr-only"
                  />
                  <span
                    className={`w-3 h-3 rounded-full border-2 transition-all ${
                      activeContributors.has(key) ? 'scale-100' : 'scale-75 opacity-30'
                    }`}
                    style={{
                      backgroundColor: activeContributors.has(key) ? color : 'transparent',
                      borderColor: color,
                    }}
                  />
                  <span className={`text-xs font-mono transition-opacity ${
                    activeContributors.has(key) ? 'text-zinc-200' : 'text-zinc-500'
                  }`}>
                    {label}
                  </span>
                  <span className="text-xs text-zinc-600 ml-auto">
                    {key === 'bot' ? botNodeCount : humanNodeCount}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-800">
            <p className="text-xs font-mono text-zinc-500">
              {visibleNodeCount} nodes · {visibleEdgeCount} edges
            </p>
            {(visibleNodeCount < data.nodes.length) && (
              <p className="text-xs font-mono text-zinc-600 mt-1">
                ({data.nodes.length - visibleNodeCount} hidden)
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
