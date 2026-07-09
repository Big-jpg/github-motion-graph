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

interface GraphControlsProps {
  data: GraphData;
  onFilterChange: (filters: {
    nodeTypes: Set<string>;
    repos: Set<string>;
    users: Set<string>;
  }) => void;
}

export default function GraphControls({ data, onFilterChange }: GraphControlsProps) {
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(NODE_TYPES.map(t => t.key))
  );
  const [expanded, setExpanded] = useState(false);

  const repos = [...new Set(data.nodes.filter(n => n.type === 'repository').map(n => n.label))];
  const users = [...new Set(data.nodes.filter(n => n.type === 'user').map(n => n.label))];

  const toggleType = (type: string) => {
    const next = new Set(activeTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setActiveTypes(next);
    onFilterChange({ nodeTypes: next, repos: new Set(), users: new Set() });
  };

  return (
    <div className="absolute bottom-4 left-4 z-10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="bg-zinc-900/90 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 hover:border-zinc-500 transition-colors backdrop-blur-sm"
      >
        {expanded ? '✕ Close' : '◉ Filters'}
      </button>

      {expanded && (
        <div className="mt-2 bg-zinc-900/95 border border-zinc-700 rounded-lg p-4 backdrop-blur-sm min-w-[200px]">
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

          <div className="mt-4 pt-3 border-t border-zinc-800">
            <p className="text-xs font-mono text-zinc-500 uppercase mb-2">Legend</p>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 rounded-full bg-pink-500" />
              <span className="text-xs text-zinc-400">AI/Bot contributor</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-xs text-zinc-400">Human contributor</span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-800">
            <p className="text-xs font-mono text-zinc-500">
              {data.nodes.length} nodes · {data.edges.length} edges
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
