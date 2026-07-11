"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ForceGraphVisualization from "@/components/ForceGraph";
import GraphControls from "@/components/GraphControls";
import { DEFAULT_DYNAMICS, type GraphFilters } from "@/components/GraphControls";
import type { ForceGraphNode, GraphData } from "@/lib/types";

type SelectedNode = ForceGraphNode & { strokeColor?: string };

const initialFilters = (): GraphFilters => ({
  nodeTypes: new Set(["repository", "branch", "commit", "pullRequest", "user"]),
  repos: new Set<string>(),
  users: new Set<string>(),
  contributors: new Set(["bot", "human"]),
  connections: true,
  dynamics: DEFAULT_DYNAMICS,
});

export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [filters, setFilters] = useState<GraphFilters>(initialFilters);
  const [visibleCounts, setVisibleCounts] = useState({ nodes: 0, edges: 0 });
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchData() {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const response = await fetch("/api/graph", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`The graph API returned ${response.status}.`);
        }

        const json = (await response.json()) as Partial<GraphData>;
        if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) {
          throw new Error("The graph API returned an invalid response.");
        }
        setData({ nodes: json.nodes, edges: json.edges, meta: json.meta });
      } catch (caughtError) {
        if (controller.signal.aborted) return;
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "GitHub activity could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchData();
    return () => controller.abort();
  }, [requestKey]);

  const handleNodeClick = useCallback((node: ForceGraphNode) => {
    setSelectedNode(node as SelectedNode);
  }, []);

  const handleVisibleCountChange = useCallback((nodes: number, edges: number) => {
    setVisibleCounts({ nodes, edges });
  }, []);

  if (loading) {
    return (
      <GraphStateShell>
        <div role="status" className="text-center">
          <span className="mx-auto block size-10 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
          <h1 className="mt-5 font-display text-xl font-medium">
            Mapping your GitHub activity
          </h1>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Connecting repositories, branches, commits, and pull requests…
          </p>
        </div>
      </GraphStateShell>
    );
  }

  if (error) {
    return (
      <GraphStateShell>
        <div role="alert" className="text-center">
          <StateIcon tone="coral" />
          <h1 className="mt-5 font-display text-2xl font-medium">
            The graph could not load
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-muted-foreground">
            {error} Check the live index connection, then try again.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setRequestKey(key => key + 1)}
              className="pastel-control pastel-primary px-5 text-sm font-extrabold"
            >
              Try again
            </button>
            <Link href="/" className="pastel-control px-5 text-sm font-extrabold">
              Back home
            </Link>
          </div>
        </div>
      </GraphStateShell>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <GraphStateShell>
        <div className="text-center">
          <StateIcon tone="yellow" />
          <h1 className="mt-5 font-display text-2xl font-medium">
            No activity is indexed yet
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-muted-foreground">
            The live index currently contains no graph records. Run the repository
            ingestion workflow, then refresh this page to explore the result.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setRequestKey(key => key + 1)}
              className="pastel-control pastel-primary px-5 text-sm font-extrabold"
            >
              Check again
            </button>
            <Link href="/" className="pastel-control px-5 text-sm font-extrabold">
              Back home
            </Link>
          </div>
        </div>
      </GraphStateShell>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <header className="absolute top-3 left-3 z-20 sm:top-4 sm:left-4">
        <Link href="/" className="pastel-control gap-2 px-4 text-sm font-extrabold">
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.25"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span className="hidden sm:inline">GitHub Motion Graph</span>
          <span className="sm:hidden">Home</span>
        </Link>
      </header>

      <ForceGraphVisualization
        data={data}
        width={dimensions.width}
        height={dimensions.height}
        selectedNodeId={selectedNode?.id ?? null}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => setSelectedNode(null)}
        onVisibleCountChange={handleVisibleCountChange}
        filters={filters}
      />

      <GraphControls
        data={data}
        visibleNodeCount={visibleCounts.nodes}
        visibleEdgeCount={visibleCounts.edges}
        onFilterChange={setFilters}
      />

      {selectedNode && (
        <NodeDetails node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}
    </div>
  );
}

function GraphStateShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-36 top-10 size-[28rem] rounded-full bg-[#d3f2e6]/70 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 bottom-0 size-[26rem] rounded-full bg-[#d9eefb]/60 blur-3xl"
      />
      <section className="pastel-panel relative w-full max-w-xl p-7 sm:p-10">
        {children}
      </section>
    </main>
  );
}

function StateIcon({ tone }: { tone: "coral" | "yellow" }) {
  const fill = tone === "coral" ? "#e7ab9c" : "#f1d580";
  const stroke = tone === "coral" ? "#965d51" : "#806b26";
  return (
    <span
      aria-hidden="true"
      className="mx-auto grid size-14 place-items-center rounded-[1.2rem] border-[3px]"
      style={{ backgroundColor: fill, borderColor: stroke }}
    >
      <svg
        className="size-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke={stroke}
        strokeWidth="2.25"
      >
        {tone === "coral" ? (
          <path d="M12 8v5m0 3h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16a2 2 0 0 0 1.73 3Z" />
        ) : (
          <path d="M5 7h14M5 12h9M5 17h6" />
        )}
      </svg>
    </span>
  );
}

function NodeDetails({
  node,
  onClose,
}: {
  node: SelectedNode;
  onClose: () => void;
}) {
  return (
    <aside
      aria-live="polite"
      aria-label={`Selected ${node.type}: ${node.label}`}
      className="pastel-panel absolute inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 max-h-[min(55svh,30rem)] overflow-y-auto p-5 sm:inset-x-auto sm:top-4 sm:right-4 sm:bottom-auto sm:w-[22rem]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border-2"
            style={{
              backgroundColor: node.color ?? "#b7c8bd",
              borderColor: node.strokeColor ?? "#5a6e62",
            }}
          />
          <span className="truncate text-[0.68rem] font-black uppercase tracking-[0.13em] text-muted-foreground">
            {node.type}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close node details"
          onClick={onClose}
          className="pastel-control size-11 shrink-0 p-0 text-muted-foreground"
        >
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.25"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <h2 className="mt-3 font-display text-2xl font-medium leading-tight">{node.label}</h2>
      {node.metadata && (
        <dl className="mt-4 space-y-2 border-t-2 border-border pt-4 font-mono text-[0.7rem]">
          {Object.entries(node.metadata).map(([key, value]) => {
            if (value == null || value === "" || key === "avatarUrl") return null;
            return (
              <div key={key} className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-4">
                <dt className="truncate text-muted-foreground">{key}</dt>
                <dd className="break-words text-right text-foreground">{String(value)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </aside>
  );
}
