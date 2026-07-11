"use client";

import { useMemo, useState } from "react";
import type { GraphData } from "@/lib/types";

export const NODE_TYPES = [
  {
    key: "repository",
    label: "Repositories",
    shortLabel: "Repos",
    fill: "#c7b4e6",
    stroke: "#735f91",
  },
  {
    key: "branch",
    label: "Branches",
    shortLabel: "Branches",
    fill: "#9fc8e7",
    stroke: "#557f9d",
  },
  {
    key: "commit",
    label: "Commits",
    shortLabel: "Commits",
    fill: "#b7c8bd",
    stroke: "#5a6e62",
  },
  {
    key: "pullRequest",
    label: "Pull requests",
    shortLabel: "PRs",
    fill: "#f1d580",
    stroke: "#806b26",
  },
  {
    key: "user",
    label: "Contributors",
    shortLabel: "People",
    fill: "#82c7b6",
    stroke: "#4f8d7c",
  },
] as const;

export const CONTRIBUTOR_TYPES = [
  {
    key: "bot",
    label: "AI / bot",
    fill: "#e7ab9c",
    stroke: "#965d51",
  },
  {
    key: "human",
    label: "Human",
    fill: "#82c7b6",
    stroke: "#4f8d7c",
  },
] as const;

export interface GraphFilters {
  nodeTypes: Set<string>;
  repos: Set<string>;
  users: Set<string>;
  contributors: Set<string>;
}

interface GraphControlsProps {
  data: GraphData;
  visibleNodeCount: number;
  visibleEdgeCount: number;
  onFilterChange: (filters: GraphFilters) => void;
}

export default function GraphControls({
  data,
  visibleNodeCount,
  visibleEdgeCount,
  onFilterChange,
}: GraphControlsProps) {
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(NODE_TYPES.map(type => type.key)),
  );
  const [activeContributors, setActiveContributors] = useState<Set<string>>(
    new Set(CONTRIBUTOR_TYPES.map(type => type.key)),
  );
  const [expanded, setExpanded] = useState(false);

  const nodeCounts = useMemo(
    () =>
      Object.fromEntries(
        NODE_TYPES.map(type => [
          type.key,
          data.nodes.filter(node => node.type === type.key).length,
        ]),
      ),
    [data.nodes],
  );

  const contributorCounts = useMemo(
    () => ({
      bot: data.nodes.filter(node => node.contributorType === "bot").length,
      human: data.nodes.filter(node => node.contributorType === "human").length,
    }),
    [data.nodes],
  );

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

  const resetFilters = () => {
    const types = new Set<string>(NODE_TYPES.map(type => type.key));
    const contributors = new Set<string>(CONTRIBUTOR_TYPES.map(type => type.key));
    setActiveTypes(types);
    setActiveContributors(contributors);
    emitFilters(types, contributors);
  };

  const allFiltersActive =
    activeTypes.size === NODE_TYPES.length &&
    activeContributors.size === CONTRIBUTOR_TYPES.length;

  return (
    <div
      className="absolute inset-x-3 z-30 flex flex-col-reverse items-start gap-2 sm:right-auto sm:left-4 sm:w-[19rem]"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <button
        type="button"
        aria-controls="graph-filter-panel"
        aria-expanded={expanded}
        onClick={() => setExpanded(current => !current)}
        className="pastel-control gap-2 px-4 text-sm font-extrabold"
      >
        {expanded ? (
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
        ) : (
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.25"
          >
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
        )}
        {expanded ? "Close filters" : "Filter graph"}
        {!expanded && !allFiltersActive && (
          <span className="grid size-5 place-items-center rounded-full bg-accent text-[0.65rem] font-black text-accent-foreground">
            {activeTypes.size + activeContributors.size}
          </span>
        )}
      </button>

      {expanded && (
        <section
          id="graph-filter-panel"
          aria-label="Graph filters"
          className="pastel-panel max-h-[min(70svh,36rem)] w-full overflow-y-auto p-3 sm:p-4"
        >
          <div className="flex items-center justify-between gap-3 px-2 pb-2">
            <div>
              <p className="font-display text-xl font-medium">Filter the map</p>
              <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                Choose what stays visible.
              </p>
            </div>
            {!allFiltersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-11 rounded-full px-3 text-xs font-extrabold text-[#3d7f70] hover:bg-secondary"
              >
                Reset
              </button>
            )}
          </div>

          <div className="mt-2 border-t-2 border-border pt-3">
            <p className="px-2 pb-1 text-[0.68rem] font-black uppercase tracking-[0.14em] text-muted-foreground">
              Node types
            </p>
            <div className="space-y-1">
              {NODE_TYPES.map(type => {
                const active = activeTypes.has(type.key);
                return (
                  <button
                    key={type.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleType(type.key)}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-2xl border-2 px-3 text-left transition-colors ${
                      active
                        ? "border-border bg-secondary text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-4 shrink-0 border-2 transition-transform ${
                        type.key === "pullRequest"
                          ? "rotate-45 rounded-[0.2rem]"
                          : type.key === "branch"
                            ? "rounded-[0.3rem]"
                            : "rounded-full"
                      } ${active ? "scale-100" : "scale-75 opacity-45"}`}
                      style={{
                        backgroundColor: active ? type.fill : "transparent",
                        borderColor: type.stroke,
                      }}
                    />
                    <span className="text-sm font-extrabold">{type.label}</span>
                    <span className="ml-auto font-mono text-[0.7rem] font-semibold text-muted-foreground">
                      {nodeCounts[type.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 border-t-2 border-border pt-3">
            <p className="px-2 pb-1 text-[0.68rem] font-black uppercase tracking-[0.14em] text-muted-foreground">
              Contributors
            </p>
            <div className="space-y-1">
              {CONTRIBUTOR_TYPES.map(type => {
                const active = activeContributors.has(type.key);
                return (
                  <button
                    key={type.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleContributor(type.key)}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-2xl border-2 px-3 text-left transition-colors ${
                      active
                        ? "border-border bg-secondary text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                        active ? "opacity-100" : "opacity-45"
                      }`}
                      style={{ backgroundColor: type.fill, borderColor: type.stroke }}
                    >
                      <span
                        className="size-2 rounded-full border"
                        style={{ borderColor: type.stroke }}
                      />
                    </span>
                    <span className="text-sm font-extrabold">{type.label}</span>
                    <span className="ml-auto font-mono text-[0.7rem] font-semibold text-muted-foreground">
                      {contributorCounts[type.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            aria-live="polite"
            className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-[#f5f9f6] px-4 py-3"
          >
            <span className="text-xs font-extrabold text-muted-foreground">Visible now</span>
            <span className="font-mono text-[0.72rem] font-semibold text-foreground">
              {visibleNodeCount} nodes · {visibleEdgeCount} edges
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
