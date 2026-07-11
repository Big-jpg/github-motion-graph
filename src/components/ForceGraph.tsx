"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  ForceGraphMethods,
  ForceGraphProps as ForceGraphLibraryProps,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d";
import type { MutableRefObject, ReactElement } from "react";
import type { ForceGraphLink, ForceGraphNode, GraphData, GraphEdge, GraphNode } from "@/lib/types";
import { CONTRIBUTOR_TYPES, DEFAULT_DYNAMICS, NODE_TYPES } from "./GraphControls";
import type { GraphFilters } from "./GraphControls";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

type NodeVisual = ForceGraphNode & {
  color: string;
  strokeColor: string;
  size: number;
};

type LinkVisual = Omit<ForceGraphLink, "source" | "target"> & {
  color: string;
};

type TypedForceGraphProps = ForceGraphLibraryProps<NodeVisual, LinkVisual> & {
  ref?: MutableRefObject<ForceGraphMethods<NodeVisual, LinkVisual> | undefined>;
};

const TypedForceGraph2D = ForceGraph2D as unknown as (
  props: TypedForceGraphProps,
) => ReactElement;

const NODE_STYLES = Object.fromEntries(
  NODE_TYPES.map(type => [type.key, { fill: type.fill, stroke: type.stroke }]),
) as Record<ForceGraphNode["type"], { fill: string; stroke: string }>;

const BOT_STYLE = CONTRIBUTOR_TYPES.find(type => type.key === "bot") ?? {
  fill: "#e7ab9c",
  stroke: "#965d51",
};

const EDGE_STYLES: Record<string, { color: string; dash?: number[] }> = {
  AUTHORED: { color: "#4f8d7c" },
  OPENED: { color: "#806b26", dash: [2, 3] },
  MERGED: { color: "#965d51", dash: [6, 4] },
  BELONGS_TO: { color: "#8ca498" },
  TARGETS: { color: "#557f9d", dash: [4, 3] },
  FROM: { color: "#735f91" },
  PART_OF: { color: "#789086" },
  SUMMARY: { color: "#b5c8be" },
};

const NODE_SIZES: Record<ForceGraphNode["type"], number> = {
  repository: 12,
  branch: 7,
  commit: 4,
  pullRequest: 8,
  user: 10,
};

type LodLevel = "overview" | "medium" | "detail";
const MEDIUM_COMMIT_LIMIT = 1500;
const SUMMARY_LINK_LIMIT = 4000;

function lodCommitIds(nodes: GraphNode[], level: LodLevel) {
  if (level === "detail") return null;
  if (level === "overview") return new Set<string>();
  return new Set(
    nodes
      .filter(node => node.type === "commit")
      .sort((left, right) => {
        const leftDate = Date.parse(String(left.metadata.committedAt ?? "")) || 0;
        const rightDate = Date.parse(String(right.metadata.committedAt ?? "")) || 0;
        return rightDate - leftDate;
      })
      .slice(0, MEDIUM_COMMIT_LIMIT)
      .map(node => node.id),
  );
}

function contractHiddenCommits(
  edges: GraphEdge[],
  visibleIds: Set<string>,
  hiddenCommitIds: Set<string>,
  nodeTypes: Map<string, GraphNode["type"]>,
) {
  const normal: GraphEdge[] = [];
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceVisible = visibleIds.has(edge.source);
    const targetVisible = visibleIds.has(edge.target);
    if (sourceVisible && targetVisible) {
      normal.push(edge);
      continue;
    }
    const hiddenId = hiddenCommitIds.has(edge.source)
      ? edge.source
      : hiddenCommitIds.has(edge.target)
        ? edge.target
        : null;
    if (!hiddenId) continue;
    const neighbor = hiddenId === edge.source ? edge.target : edge.source;
    if (!visibleIds.has(neighbor)) continue;
    const set = neighbors.get(hiddenId) ?? new Set<string>();
    set.add(neighbor);
    neighbors.set(hiddenId, set);
  }

  const summaries = new Map<string, GraphEdge>();
  for (const adjacent of neighbors.values()) {
    const people = [...adjacent].filter(id => nodeTypes.get(id) === "user").slice(0, 4);
    const structure = [...adjacent]
      .filter(id => ["branch", "pullRequest", "repository"].includes(nodeTypes.get(id) ?? ""))
      .slice(0, 8);
    const pairs: Array<[string, string]> = [];
    for (const person of people) {
      for (const anchor of structure) pairs.push([person, anchor]);
    }
    if (people.length === 0) {
      const branches = structure.filter(id => nodeTypes.get(id) === "branch").slice(0, 4);
      const pullRequests = structure.filter(id => nodeTypes.get(id) === "pullRequest").slice(0, 4);
      for (const branch of branches) {
        for (const pullRequest of pullRequests) pairs.push([branch, pullRequest]);
      }
    }
    for (const pair of pairs) {
        const [source, target] = pair[0] < pair[1]
          ? pair
          : [pair[1], pair[0]];
        const key = `${source}\u0000${target}`;
        const existing = summaries.get(key);
        if (existing) existing.weight += 1;
        else summaries.set(key, { source, target, type: "SUMMARY", weight: 1 });
    }
  }
  const strongest = [...summaries.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, SUMMARY_LINK_LIMIT)
    .map(edge => ({ ...edge, weight: Math.min(8, 0.35 + Math.log2(edge.weight + 1)) }));
  return [...normal, ...strongest];
}

type SemanticForce = ((alpha: number) => void) & {
  initialize: (nodes: NodeVisual[]) => void;
  advanceLocomotion: () => void;
};

function createSemanticForce(locomotion: boolean): SemanticForce {
  let nodes: NodeVisual[] = [];
  const orbits = new Map<string, {
    originX: number;
    originY: number;
    phase: number;
    radius: number;
    direction: number;
    spiral: number;
  }>();
  const force = ((alpha: number) => {
    if (nodes.length === 0) return;

    const centers = new Map<string, { x: number; y: number; count: number }>();
    for (const node of nodes) {
      const center = centers.get(node.type) ?? { x: 0, y: 0, count: 0 };
      center.x += node.x ?? 0;
      center.y += node.y ?? 0;
      center.count++;
      centers.set(node.type, center);
    }
    const cohesionStrength = 0.0028 * alpha;
    for (const node of nodes) {
      const center = centers.get(node.type);
      if (!center || center.count < 2) continue;
      node.vx = (node.vx ?? 0) + (center.x / center.count - (node.x ?? 0)) * cohesionStrength;
      node.vy = (node.vy ?? 0) + (center.y / center.count - (node.y ?? 0)) * cohesionStrength;
    }

    {
      const cellSize = 34;
      const buckets = new Map<string, NodeVisual[]>();
      const strength = 0.17 * alpha;
      for (const node of nodes) {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        let compared = 0;
        for (let offsetX = -1; offsetX <= 1 && compared < 18; offsetX++) {
          for (let offsetY = -1; offsetY <= 1 && compared < 18; offsetY++) {
            const nearby = buckets.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];
            for (let index = nearby.length - 1; index >= 0 && compared < 18; index--) {
              const other = nearby[index];
              let dx = x - (other.x ?? 0);
              let dy = y - (other.y ?? 0);
              let distance = Math.hypot(dx, dy);
              const unlike = node.type !== other.type;
              const minimum = ((node.size ?? 5) + (other.size ?? 5) + 5) * (unlike ? 1.35 : 1);
              if (distance < minimum) {
                if (distance < 0.01) {
                  dx = 0.01 + Math.random() * 0.02;
                  dy = 0.01 + Math.random() * 0.02;
                  distance = Math.hypot(dx, dy);
                }
                const pressure = ((minimum - distance) / distance) * strength;
                node.vx = (node.vx ?? 0) + dx * pressure;
                node.vy = (node.vy ?? 0) + dy * pressure;
                other.vx = (other.vx ?? 0) - dx * pressure;
                other.vy = (other.vy ?? 0) - dy * pressure;
              }
              compared++;
            }
          }
        }
        const key = `${cellX}:${cellY}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(node);
        buckets.set(key, bucket);
      }
    }

    if (locomotion) {
      for (const node of nodes) {
        if (node.type !== "user") continue;
        const orbit = orbits.get(node.id);
        if (!orbit) continue;
        const breathingRadius = orbit.radius * (1 + Math.sin(orbit.phase * 0.45) * orbit.spiral);
        const targetX = orbit.originX + Math.cos(orbit.phase) * breathingRadius;
        const targetY = orbit.originY + Math.sin(orbit.phase) * breathingRadius * 0.72;
        const lerpStrength = 0.018 * alpha;
        node.vx = (node.vx ?? 0) + (targetX - (node.x ?? 0)) * lerpStrength;
        node.vy = (node.vy ?? 0) + (targetY - (node.y ?? 0)) * lerpStrength;
      }
    }
  }) as SemanticForce;
  force.initialize = nextNodes => {
    nodes = nextNodes;
    for (const node of nodes) {
      if (node.type !== "user" || orbits.has(node.id)) continue;
      orbits.set(node.id, {
        originX: node.x ?? 0,
        originY: node.y ?? 0,
        phase: Math.random() * Math.PI * 2,
        radius: 8 + Math.random() * 18,
        direction: Math.random() > 0.5 ? 1 : -1,
        spiral: 0.05 + Math.random() * 0.16,
      });
    }
  };
  force.advanceLocomotion = () => {
    for (const orbit of orbits.values()) {
      orbit.phase += (0.08 + orbit.radius * 0.0015) * orbit.direction;
    }
  };
  return force;
}

interface ForceGraphProps {
  data: GraphData;
  width: number;
  height: number;
  selectedNodeId?: string | null;
  onNodeClick?: (node: ForceGraphNode) => void;
  onBackgroundClick?: () => void;
  onVisibleCountChange?: (nodes: number, edges: number) => void;
  filters?: GraphFilters;
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const left = x - width / 2;
  const top = y - height / 2;
  const right = left + width;
  const bottom = top + height;

  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.quadraticCurveTo(right, top, right, top + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(left + radius, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();
}

function traceNodeShape(
  node: NodeObject<NodeVisual>,
  ctx: CanvasRenderingContext2D,
  size: number,
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  if (node.type === "repository") {
    traceRoundedRect(ctx, x, y, size * 1.8, size * 1.35, size * 0.42);
    return;
  }

  ctx.beginPath();
  if (node.type === "branch") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.9, y + size * 0.75);
    ctx.lineTo(x - size * 0.9, y + size * 0.75);
    ctx.closePath();
  } else if (node.type === "pullRequest") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, size, 0, 2 * Math.PI);
  }
}

export default function ForceGraphVisualization({
  data,
  width,
  height,
  selectedNodeId = null,
  onNodeClick,
  onBackgroundClick,
  onVisibleCountChange,
  filters,
}: ForceGraphProps) {
  const fgRef = useRef<ForceGraphMethods<NodeVisual, LinkVisual> | undefined>(
    undefined,
  );
  const [hoveredNode, setHoveredNode] = useState<NodeObject<NodeVisual> | null>(
    null,
  );
  const [reduceMotion, setReduceMotion] = useState(false);
  const [lodLevel, setLodLevel] = useState<LodLevel>("overview");
  const lodTimer = useRef<number | null>(null);
  const fittedSignature = useRef<string | null>(null);
  const canvasFontFamily = useRef("ui-rounded, system-ui, sans-serif");

  useEffect(() => {
    canvasFontFamily.current = getComputedStyle(document.body).fontFamily;
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  const graphData = useMemo(() => {
    let filteredNodes = data.nodes;

    if (filters) {
      filteredNodes = data.nodes.filter(node => {
        if (!filters.nodeTypes.has(node.type)) return false;
        if (
          node.contributorType &&
          !filters.contributors.has(node.contributorType)
        ) {
          return false;
        }
        if (
          filters.repos.size > 0 &&
          node.type === "repository" &&
          !filters.repos.has(node.label)
        ) {
          return false;
        }
        if (
          filters.users.size > 0 &&
          node.type === "user" &&
          !filters.users.has(node.label)
        ) {
          return false;
        }
        return true;
      });
    }

    const allowedCommitIds = lodCommitIds(filteredNodes, lodLevel);
    const lodNodes = allowedCommitIds === null
      ? filteredNodes
      : filteredNodes.filter(node => node.type !== "commit" || allowedCommitIds.has(node.id));
    const nodeIds = new Set(lodNodes.map(node => node.id));
    const nodeTypes = new Map(lodNodes.map(node => [node.id, node.type]));
    const hiddenCommitIds = new Set(
      filteredNodes
        .filter(node => node.type === "commit" && !nodeIds.has(node.id))
        .map(node => node.id),
    );
    const filteredEdges = hiddenCommitIds.size > 0
      ? contractHiddenCommits(data.edges, nodeIds, hiddenCommitIds, nodeTypes)
      : data.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));

    const nodes: NodeVisual[] = lodNodes.map(node => {
      const isBot =
        node.type === "user" &&
        (node.metadata.isBot === true || node.contributorType === "bot");
      const style = isBot ? BOT_STYLE : NODE_STYLES[node.type];
      return {
        ...node,
        color: style.fill,
        strokeColor: style.stroke,
        size: NODE_SIZES[node.type],
      };
    });

    const links: LinkObject<NodeVisual, LinkVisual>[] = filteredEdges.map(edge => ({
      ...edge,
      color: EDGE_STYLES[edge.type]?.color ?? "#8ca498",
    }));

    return { nodes, links };
  }, [data, filters, lodLevel]);

  const dynamics = filters?.dynamics ?? DEFAULT_DYNAMICS;
  const semanticForce = useMemo(
    () => createSemanticForce(
      dynamics.locomotion && !reduceMotion && lodLevel !== "detail",
    ),
    [dynamics.locomotion, lodLevel, reduceMotion],
  );

  const fitSignature = useMemo(
    () => `${data.nodes.length}:${data.edges.length}:${[...(filters?.nodeTypes ?? [])].join(",")}:${[...(filters?.contributors ?? [])].join(",")}`,
    [data, filters?.contributors, filters?.nodeTypes],
  );

  useEffect(() => {
    onVisibleCountChange?.(
      graphData.nodes.length,
      filters?.connections === false ? 0 : graphData.links.length,
    );
  }, [filters?.connections, graphData, onVisibleCountChange]);

  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.d3Force("semantic-dynamics", semanticForce as never);
    graph.d3ReheatSimulation();
    return () => {
      graph.d3Force("semantic-dynamics", null as never);
    };
  }, [graphData, semanticForce]);

  useEffect(() => {
    if (reduceMotion || lodLevel === "detail" || !dynamics.locomotion) return;
    const timer = window.setInterval(() => {
      semanticForce.advanceLocomotion();
      fgRef.current?.d3ReheatSimulation();
    }, 650);
    return () => window.clearInterval(timer);
  }, [dynamics.locomotion, lodLevel, reduceMotion, semanticForce]);

  const handleNodeClick = useCallback(
    (node: NodeObject<NodeVisual>) => {
      onNodeClick?.(node);
      if (fgRef.current && node.x != null && node.y != null) {
        const duration = reduceMotion ? 0 : 500;
        fgRef.current.centerAt(node.x, node.y, duration);
        fgRef.current.zoom(3, duration);
      }
    },
    [onNodeClick, reduceMotion],
  );

  const paintNode = useCallback(
    (
      node: NodeObject<NodeVisual>,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => {
      const size = node.size ?? 5;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNodeId === node.id;
      const scale = isHovered ? 1.18 : isSelected ? 1.12 : 1;
      const renderedSize = size * scale;

      ctx.save();
      traceNodeShape(node, ctx, renderedSize);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.strokeStyle = node.strokeColor;
      ctx.lineWidth = (isHovered || isSelected ? 3 : 2) / globalScale;
      ctx.stroke();

      if (node.type === "user") {
        ctx.beginPath();
        ctx.arc(x, y, renderedSize * 0.5, 0, 2 * Math.PI);
        ctx.strokeStyle = node.strokeColor;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();

        if (node.metadata.isBot === true || node.contributorType === "bot") {
          ctx.beginPath();
          ctx.arc(x, y, renderedSize * 1.35, 0, 2 * Math.PI);
          ctx.setLineDash([3 / globalScale, 2.5 / globalScale]);
          ctx.strokeStyle = BOT_STYLE.stroke;
          ctx.lineWidth = 1.5 / globalScale;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (isSelected || isHovered) {
        const ringRadius = renderedSize * 1.65 + 3 / globalScale;
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = isSelected ? "#2d3a32" : node.strokeColor;
        ctx.lineWidth = (isSelected ? 2 : 1.5) / globalScale;
        ctx.stroke();
      }

      const showLabel =
        isHovered ||
        isSelected ||
        (globalScale > 1.25 &&
          (node.type === "repository" || node.type === "user"));

      if (showLabel) {
        const label =
          node.label.length > 38 ? `${node.label.slice(0, 35)}…` : node.label;
        const fontSize = 12 / globalScale;
        ctx.font = `800 ${fontSize}px ${canvasFontFamily.current}`;
        const labelWidth = ctx.measureText(label).width;
        const horizontalPadding = 6 / globalScale;
        const labelHeight = 21 / globalScale;
        const labelY = y + renderedSize + 13 / globalScale;

        traceRoundedRect(
          ctx,
          x,
          labelY,
          labelWidth + horizontalPadding * 2,
          labelHeight,
          7 / globalScale,
        );
        ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
        ctx.fill();
        ctx.strokeStyle = "#dfeae2";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
        ctx.fillStyle = "#2d3a32";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, labelY + 0.5 / globalScale);
      }

      ctx.restore();
    },
    [hoveredNode, selectedNodeId],
  );

  const paintLink = useCallback(
    (
      link: LinkObject<NodeVisual, LinkVisual>,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => {
      if (typeof link.source !== "object" || typeof link.target !== "object") {
        return;
      }

      const start = link.source;
      const end = link.target;
      if (start.x == null || start.y == null || end.x == null || end.y == null) {
        return;
      }

      const style = EDGE_STYLES[link.type] ?? { color: "#8ca498" };
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      if (style.dash) {
        ctx.setLineDash(style.dash.map(value => value / globalScale));
      }
      ctx.strokeStyle = link.color || style.color;
      ctx.globalAlpha = Math.min(0.62, 0.24 + (link.weight ?? 1) * 0.08);
      ctx.lineWidth = Math.max(1, (link.weight ?? 1) * 0.55) / globalScale;
      ctx.stroke();
      ctx.restore();
    },
    [],
  );

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return;
    if (fittedSignature.current === fitSignature) return;
    fittedSignature.current = fitSignature;

    const timer = window.setTimeout(
      () => {
        fgRef.current?.zoomToFit(reduceMotion ? 0 : 400, 64);
      },
      reduceMotion ? 0 : 450,
    );
    return () => window.clearTimeout(timer);
  }, [fitSignature, graphData, reduceMotion]);

  useEffect(() => () => {
    if (lodTimer.current !== null) window.clearTimeout(lodTimer.current);
  }, []);

  const handleZoom = useCallback(({ k }: { k: number }) => {
    if (lodTimer.current !== null) window.clearTimeout(lodTimer.current);
    lodTimer.current = window.setTimeout(() => {
      const next: LodLevel = k >= 4 ? "detail" : k >= 1.4 ? "medium" : "overview";
      setLodLevel(current => current === next ? current : next);
    }, 140);
  }, []);

  return (
    <section
      className="relative h-full w-full"
      role="img"
      aria-label={`Interactive GitHub activity graph with ${graphData.nodes.length} visible nodes and ${graphData.links.length} visible relationships.`}
    >
      <p className="sr-only">
        Use the filter controls to change what is shown. Select a node with a
        pointer to inspect its metadata.
      </p>
      <TypedForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor="#f5f9f6"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx, globalScale) => {
          const visualNode = node as NodeObject<NodeVisual>;
          const radius = Math.max((visualNode.size ?? 5) * 1.75, 22 / globalScale);
          ctx.beginPath();
          ctx.arc(visualNode.x ?? 0, visualNode.y ?? 0, radius, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObject={paintLink}
        linkVisibility={filters?.connections !== false}
        onZoom={handleZoom}
        onNodeClick={handleNodeClick}
        onNodeHover={node => setHoveredNode(node as NodeObject<NodeVisual> | null)}
        onBackgroundClick={() => onBackgroundClick?.()}
        showPointerCursor
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.34}
        warmupTicks={50}
        cooldownTicks={100}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
      />

      <div className="pastel-control pointer-events-none absolute top-4 right-4 z-10 min-h-9 px-3 text-xs font-extrabold sm:top-auto sm:right-4 sm:bottom-4">
        {lodLevel === "overview"
          ? "Overview · commits summarized"
          : lodLevel === "medium"
            ? `Mid detail · newest ${MEDIUM_COMMIT_LIMIT.toLocaleString()} commits`
            : "Full commit detail"}
      </div>

      {hoveredNode && !selectedNodeId && (
        <aside className="pastel-panel pointer-events-none absolute inset-x-3 top-20 z-20 max-h-[45svh] overflow-hidden p-4 sm:inset-x-auto sm:top-4 sm:right-4 sm:w-80">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-4 rounded-full border-2"
              style={{
                backgroundColor: hoveredNode.color,
                borderColor: hoveredNode.strokeColor,
              }}
            />
            <span className="text-[0.68rem] font-black uppercase tracking-[0.13em] text-muted-foreground">
              {hoveredNode.type}
            </span>
          </div>
          <p className="mt-2 font-display text-lg font-medium leading-tight text-foreground">
            {hoveredNode.label}
          </p>
          {hoveredNode.metadata && (
            <dl className="mt-3 space-y-1.5 border-t-2 border-border pt-3 font-mono text-[0.68rem]">
              {Object.entries(hoveredNode.metadata).map(([key, value]) => {
                if (value == null || value === "" || key === "avatarUrl") return null;
                return (
                  <div key={key} className="grid grid-cols-[auto_1fr] gap-3">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="truncate text-right text-foreground">
                      {String(value).slice(0, 72)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </aside>
      )}
    </section>
  );
}
