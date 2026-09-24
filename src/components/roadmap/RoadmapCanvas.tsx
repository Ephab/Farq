"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";
import { computeRoadmapLayout } from "@/lib/roadmap-layout";
import { RoadmapEdges } from "@/components/roadmap/RoadmapEdges";
import { RoadmapNode } from "@/components/roadmap/RoadmapNode";

interface RoadmapCanvasProps {
  nodes: RoadmapNodeData[];
  stages: RoadmapStage[];
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
  dimmedIds: Set<string>;
  onSelect: (id: string | null) => void;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.5;

export function RoadmapCanvas({
  nodes,
  stages,
  statuses,
  selectedId,
  dimmedIds,
  onSelect,
}: RoadmapCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [compact, setCompact] = useState(false);
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, sl: 0, st: 0 });

  // Single-column layout on narrow containers (mobile).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCompact(el.clientWidth < 760);
    });
    ro.observe(el);
    setCompact(el.clientWidth < 760);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => computeRoadmapLayout(nodes, stages, compact), [nodes, stages, compact]);

  const stageProgress = useMemo(() => {
    const map: Record<string, { done: number; total: number }> = {};
    for (const stage of stages) {
      const total = stage.nodeIds.length;
      const done = stage.nodeIds.filter((id) => statuses[id] === "done").length;
      map[stage.id] = { done, total };
    }
    return map;
  }, [stages, statuses]);

  // Keep the selected node in view.
  useEffect(() => {
    if (!selectedId) return;
    requestAnimationFrame(() => {
      document
        .getElementById(`roadmap-node-${selectedId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [selectedId]);

  const fitView = () => {
    const el = scrollRef.current;
    if (!el) return;
    const scale = (el.clientWidth - 32) / layout.width;
    setZoom(Math.min(1, Math.max(MIN_ZOOM, scale)));
    requestAnimationFrame(() => {
      el.scrollTo({ left: 0, top: 0 });
    });
  };

  const stepZoom = (dir: 1 | -1) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + dir * 0.15) * 100) / 100)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input")) return;
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el || !drag.current.active) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    if (drag.current.moved) {
      el.scrollLeft = drag.current.sl - dx;
      el.scrollTop = drag.current.st - dy;
    }
  };
  const endDrag = () => {
    drag.current.active = false;
  };

  const onBackgroundClick = (e: React.MouseEvent) => {
    if (drag.current.moved) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input")) return;
    onSelect(null);
  };

  const allDimmed = dimmedIds.size >= nodes.length;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={onBackgroundClick}
        className="absolute inset-0 cursor-grab overflow-auto overscroll-contain active:cursor-grabbing"
        role="application"
        aria-label="Roadmap canvas. Scroll to explore, drag to pan, click a node for details."
      >
        <div
          className="relative"
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
            backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.2px)",
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${zoom})`,
            }}
          >
            <RoadmapEdges layout={layout} statuses={statuses} selectedId={selectedId} />

            {stages.map((stage, si) => {
              const anchor = layout.stageAnchors.find((a) => a.stageId === stage.id);
              if (!anchor) return null;
              const prog = stageProgress[stage.id] ?? { done: 0, total: stage.nodeIds.length };
              return (
                <div
                  key={stage.id}
                  className="absolute -translate-x-1/2 rounded-2xl border border-border bg-background/95 px-4 py-2 text-center shadow-sm backdrop-blur"
                  style={{ left: anchor.x, top: anchor.y, width: compact ? layout.width - 32 : 460, maxWidth: layout.width - 32 }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Stage {si + 1} of {stages.length}
                  </p>
                  <p className="truncate text-sm font-semibold">{stage.title.replace(/^Stage \d+ · /, "")}</p>
                  <p className="truncate text-xs text-muted-foreground">{stage.description}</p>
                  <div className="mx-auto mt-1.5 h-1 w-3/4 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {nodes.map((node, i) => {
              const p = layout.positions[node.id];
              if (!p) return null;
              return (
                <RoadmapNode
                  key={node.id}
                  node={node}
                  x={p.x}
                  y={p.y}
                  status={statuses[node.id] ?? "not-started"}
                  selected={selectedId === node.id}
                  dimmed={dimmedIds.has(node.id)}
                  index={i}
                  onSelect={onSelect}
                />
              );
            })}

            {allDimmed ? (
              <div className="absolute left-1/2 top-1/3 w-72 -translate-x-1/2 rounded-2xl border border-border bg-background p-5 text-center shadow-lg">
                <p className="text-sm font-semibold">No topics match</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a different search term or level filter.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => stepZoom(-1)}
          aria-label="Zoom out"
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Reset zoom to 100%"
          className="min-w-12 rounded-lg px-1 text-xs font-medium tabular-nums text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => stepZoom(1)}
          aria-label="Zoom in"
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <div className="h-5 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={fitView}
          aria-label="Fit roadmap to view"
          title="Fit roadmap to view"
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
