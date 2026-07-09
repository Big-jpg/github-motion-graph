// src/app/graph/[repo]/page.tsx
'use client';

import { useEffect, useState, useCallback, use } from 'react';
import ForceGraphVisualization from '@/components/ForceGraph';
import GraphControls from '@/components/GraphControls';
import type { GraphData, ForceGraphNode } from '@/lib/types';

export default function RepoGraphPage({ params }: { params: Promise<{ repo: string }> }) {
  const { repo } = use(params);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [filters, setFilters] = useState({
    nodeTypes: new Set(['repository', 'branch', 'commit', 'pullRequest', 'user']),
    repos: new Set<string>(),
    users: new Set<string>(),
  });
  const [selectedNode, setSelectedNode] = useState<ForceGraphNode | null>(null);

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/graph?repo=${encodeURIComponent(repo)}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error('Error fetching graph data:', e);
        setData({ nodes: [], edges: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [repo]);

  const handleNodeClick = useCallback((node: ForceGraphNode) => {
    setSelectedNode(node);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-zinc-500">Loading {repo}...</p>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm font-mono text-zinc-400">No data found for repository: {repo}</p>
          <a href="/graph" className="text-xs font-mono text-violet-400 hover:text-violet-300">
            ← Back to full graph
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-zinc-950">
      {/* Header */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        <a href="/graph" className="text-sm font-mono text-zinc-500 hover:text-zinc-300 transition-colors">
          ← All Repos
        </a>
        <span className="text-zinc-700">/</span>
        <span className="text-sm font-mono text-violet-400">{repo}</span>
      </div>

      {/* Graph */}
      <ForceGraphVisualization
        data={data}
        width={dimensions.width}
        height={dimensions.height}
        onNodeClick={handleNodeClick}
        filters={filters}
      />

      {/* Controls */}
      <GraphControls data={data} onFilterChange={setFilters} />

      {/* Selected Node Panel */}
      {selectedNode && (
        <div className="absolute top-4 right-4 z-10 bg-zinc-900/95 border border-zinc-700 rounded-lg p-5 max-w-sm backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: selectedNode.color }}
              />
              <span className="text-xs font-mono uppercase text-zinc-400">{selectedNode.type}</span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
            >
              ✕
            </button>
          </div>
          <p className="text-base font-medium text-zinc-100 mb-3">{selectedNode.label}</p>
          {selectedNode.metadata && (
            <div className="space-y-1.5">
              {Object.entries(selectedNode.metadata).map(([key, value]) => {
                if (!value || key === 'avatarUrl') return null;
                return (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-zinc-500 font-mono">{key}</span>
                    <span className="text-zinc-300 text-right max-w-[180px] truncate">
                      {String(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
