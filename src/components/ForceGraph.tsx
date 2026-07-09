// src/components/ForceGraph.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GraphData, ForceGraphNode, ForceGraphLink } from '@/lib/types';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

// Color palette
const NODE_COLORS: Record<string, string> = {
  repository: '#8b5cf6',   // violet
  branch: '#06b6d4',       // cyan
  commit: '#6b7280',       // gray
  pullRequest: '#f59e0b',  // amber
  user: '#10b981',         // emerald
};

const BOT_COLOR = '#ec4899'; // pink for AI/bot contributors

const EDGE_COLORS: Record<string, string> = {
  AUTHORED: '#10b981',
  OPENED: '#f59e0b',
  MERGED: '#ec4899',
  BELONGS_TO: '#374151',
  TARGETS: '#6366f1',
  FROM: '#8b5cf6',
  PART_OF: '#4b5563',
};

const NODE_SIZES: Record<string, number> = {
  repository: 12,
  branch: 6,
  commit: 3,
  pullRequest: 8,
  user: 10,
};

interface ForceGraphProps {
  data: GraphData;
  width: number;
  height: number;
  onNodeClick?: (node: ForceGraphNode) => void;
  filters?: {
    nodeTypes: Set<string>;
    repos: Set<string>;
    users: Set<string>;
  };
}

export default function ForceGraphVisualization({ data, width, height, onNodeClick, filters }: ForceGraphProps) {
  const fgRef = useRef<any>(null);
  const [hoveredNode, setHoveredNode] = useState<ForceGraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<ForceGraphNode | null>(null);

  const graphData = useMemo(() => {
    let filteredNodes = data.nodes;

    if (filters) {
      filteredNodes = data.nodes.filter(node => {
        if (!filters.nodeTypes.has(node.type)) return false;
        if (filters.repos.size > 0 && node.type === 'repository' && !filters.repos.has(node.label)) return false;
        if (filters.users.size > 0 && node.type === 'user' && !filters.users.has(node.label)) return false;
        return true;
      });
    }

    const nodeIds = new Set(filteredNodes.map(n => n.id));

    const filteredEdges = data.edges.filter(e =>
      nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    const nodes: ForceGraphNode[] = filteredNodes.map(node => ({
      ...node,
      color: node.type === 'user' && node.metadata.isBot ? BOT_COLOR : NODE_COLORS[node.type],
      size: NODE_SIZES[node.type],
    }));

    const links: ForceGraphLink[] = filteredEdges.map(edge => ({
      ...edge,
      color: EDGE_COLORS[edge.type] || '#374151',
    }));

    return { nodes, links };
  }, [data, filters]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
    onNodeClick?.(node);

    // Center on node
    if (fgRef.current) {
      fgRef.current.centerAt(node.x, node.y, 800);
      fgRef.current.zoom(3, 800);
    }
  }, [onNodeClick]);

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node || null);
    document.body.style.cursor = node ? 'pointer' : 'default';
  }, []);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = node.size || 5;
    const isHovered = hoveredNode?.id === node.id;
    const isSelected = selectedNode?.id === node.id;
    const scale = isHovered ? 1.5 : isSelected ? 1.3 : 1;

    ctx.save();

    // Glow effect
    if (isHovered || isSelected || node.type === 'repository') {
      ctx.shadowColor = node.color || '#fff';
      ctx.shadowBlur = isHovered ? 20 : isSelected ? 15 : 8;
    }

    if (node.type === 'pullRequest') {
      // Diamond shape for PRs
      const s = size * scale;
      ctx.beginPath();
      ctx.moveTo(node.x, node.y - s);
      ctx.lineTo(node.x + s, node.y);
      ctx.lineTo(node.x, node.y + s);
      ctx.lineTo(node.x - s, node.y);
      ctx.closePath();
      ctx.fillStyle = node.color;
      ctx.fill();
    } else if (node.type === 'user') {
      // Circle with ring for users
      ctx.beginPath();
      ctx.arc(node.x, node.y, size * scale, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Bot indicator ring
      if (node.metadata?.isBot) {
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();

        // Inner pulse ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * scale * 1.4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.3)';
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }
    } else {
      // Circle for other nodes
      ctx.beginPath();
      ctx.arc(node.x, node.y, size * scale, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();
    }

    // Label for larger nodes when zoomed in
    if (globalScale > 1.5 && (node.type === 'repository' || node.type === 'user' || (isHovered && globalScale > 2))) {
      ctx.shadowBlur = 0;
      ctx.font = `${10 / globalScale}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(node.label, node.x, node.y + size * scale + 2);
    }

    ctx.restore();
  }, [hoveredNode, selectedNode]);

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const start = link.source;
    const end = link.target;

    if (!start.x || !end.x) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);

    const opacity = Math.min(0.6, link.weight * 0.2);
    ctx.strokeStyle = link.color || 'rgba(55, 65, 81, 0.3)';
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(0.5, link.weight * 0.5) / globalScale;
    ctx.stroke();
    ctx.restore();
  }, []);

  // Auto-zoom to fit on data change
  useEffect(() => {
    if (fgRef.current && graphData.nodes.length > 0) {
      setTimeout(() => {
        fgRef.current?.zoomToFit(400, 50);
      }, 500);
    }
  }, [graphData]);

  if (typeof window === 'undefined') return null;

  return (
    <div className="relative w-full h-full">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor="#09090b"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          const size = (node.size || 5) * 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObject={paintLink}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        warmupTicks={50}
        cooldownTicks={100}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />

      {/* Tooltip */}
      {hoveredNode && (
        <div className="absolute top-4 right-4 bg-zinc-900/95 border border-zinc-700 rounded-lg p-4 max-w-xs backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: hoveredNode.color }}
            />
            <span className="text-xs font-mono uppercase text-zinc-400">{hoveredNode.type}</span>
          </div>
          <p className="text-sm font-medium text-zinc-100">{hoveredNode.label}</p>
          {hoveredNode.metadata && (
            <div className="mt-2 space-y-1">
              {Object.entries(hoveredNode.metadata).map(([key, value]) => {
                if (!value || key === 'avatarUrl') return null;
                return (
                  <p key={key} className="text-xs text-zinc-400">
                    <span className="text-zinc-500">{key}:</span>{' '}
                    {String(value).substring(0, 60)}
                  </p>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
