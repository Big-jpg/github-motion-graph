// src/app/graph/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import ForceGraphVisualization from '@/components/ForceGraph';
import GraphControls from '@/components/GraphControls';
import type { GraphData, ForceGraphNode } from '@/lib/types';
import { useMockData } from '@/lib/mock-data';

export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [filters, setFilters] = useState({
    nodeTypes: new Set(['repository', 'branch', 'commit', 'pullRequest', 'user']),
    repos: new Set<string>(),
    users: new Set<string>(),
  });
  const [selectedNode, setSelectedNode] = useState<ForceGraphNode | null>(null);

  const mockData = useMockData();

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
        const res = await fetch('/api/graph');
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        if (json.nodes && json.nodes.length > 0) {
          setData(json);
        } else {
          // Fall back to mock data if DB is empty
          setData(mockData);
        }
      } catch (e) {
        console.warn('Using mock data:', e);
        setData(mockData);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [mockData]);

  const handleNodeClick = useCallback((node: ForceGraphNode) => {
    setSelectedNode(node);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-zinc-500">Loading graph data...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm font-mono text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-zinc-950">
      {/* Header */}
      <div className="absolute top-4 left-4 z-10">
        <a href="/" className="text-sm font-mono text-zinc-500 hover:text-zinc-300 transition-colors">
          ← GitHub Motion Graph
        </a>
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
