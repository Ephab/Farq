"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";
import { computeHorizontalRoadmapLayout, computeRoadmapLayout, HORIZ_COL_W, NODE_W, type RoadmapOrientation } from "@/lib/roadmap-layout";
import { RoadmapEdges } from "@/components/roadmap/RoadmapEdges";
import { RoadmapNode } from "@/components/roadmap/RoadmapNode";
import { useI18n } from "@/lib/i18n/context";

interface RoadmapCanvasProps {
  nodes: RoadmapNodeData[];
  stages: RoadmapStage[];
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
  dimmedIds: Set<string>;
  onSelect: (id: string | null) => void;
  onToggleDone: (id: string) => void;
  onOpenProject?: (projectId: string) => void;
  orientation?: RoadmapOrientation;
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
  onToggleDone,
  onOpenProject,
  orientation = "vertical",
}: RoadmapCanvasProps) {
  const { t, fmt, dir } = useI18n();
  // The horizontal layout is a left-to-right progression, so in RTL it runs right-to-left: node and
  // stage x are mirrored here and the edge SVG is flipped with scaleX(-1), which maps the same
  // coordinates. The vertical layout is a top-to-bottom graph and stays physical.
  const mirror = dir === "rtl" && orientation === "horizontal";
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

  const layout = useMemo(
    () => orientation === "horizontal"
      ? computeHorizontalRoadmapLayout(nodes, stages)
      : computeRoadmapLayout(nodes, stages, compact),
    [nodes, stages, compact, orientation],
  );

  const nodeX = (x: number) => (mirror ? layout.width - x - NODE_W : x);
  const anchorX = (x: number) => (mirror ? layout.width - x : x);

  // A mirrored horizontal roadmap starts at the right edge.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && mirror) el.scrollLeft = el.scrollWidth;
  }, [mirror, layout.width]);

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
      el.scrollTo({ left: mirror ? el.scrollWidth : 0, top: 0 });
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
        className="absolute inset-0 flex cursor-grab overflow-auto overscroll-contain active:cursor-grabbing"
        role="application"
        aria-label={t("roadmap.canvas.ariaLabel")}
        dir="ltr"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.2px)",
          backgroundSize: "24px 24px",
        }}
      >
        <div
          className="relative m-auto shrink-0"
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
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
            {mirror ? (
              <div className="pointer-events-none absolute inset-0" style={{ transform: "scaleX(-1)" }}>
                <RoadmapEdges layout={layout} statuses={statuses} selectedId={selectedId} />
              </div>
            ) : (
              <RoadmapEdges layout={layout} statuses={statuses} selectedId={selectedId} />
            )}

            {stages.map((stage, si) => {
              const anchor = layout.stageAnchors.find((a) => a.stageId === stage.id);
              if (!anchor) return null;
              const prog = stageProgress[stage.id] ?? { done: 0, total: stage.nodeIds.length };
              return (
                <div
                  key={stage.id}
                  className="absolute -translate-x-1/2 rounded-2xl border border-border bg-background/95 px-4 py-2 text-center shadow-sm backdrop-blur"
                  dir={dir}
                  style={{ left: anchorX(anchor.x), top: anchor.y, width: orientation === "horizontal" ? HORIZ_COL_W : compact ? layout.width - 32 : 460, maxWidth: layout.width - 32 }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t("roadmap.canvas.stageOf", { index: fmt.number(si + 1), total: fmt.number(stages.length) })}
                  </p>
                  <p dir="auto" className="truncate text-[15px] font-semibold">{stage.title.replace(/^Stage \d+ · /, "")}</p>
                  <p dir="auto" className="truncate text-[13px] text-muted-foreground">{stage.description}</p>
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
                  x={nodeX(p.x)}
                  y={p.y}
                  status={statuses[node.id] ?? "not-started"}
                  selected={selectedId === node.id}
                  dimmed={dimmedIds.has(node.id)}
                  index={i}
                  onSelect={onSelect}
                  onToggleDone={onToggleDone}
                  onOpenProject={onOpenProject}
                />
              );
            })}

            {allDimmed ? (
              <div className="absolute left-1/2 top-1/3 w-72 -translate-x-1/2 rounded-2xl border border-border bg-background p-5 text-center shadow-lg" dir={dir}>
                <p className="text-[15px] font-semibold">{t("roadmap.canvas.noMatchTitle")}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t("roadmap.canvas.noMatchBody")}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Edge fades hint that the canvas scrolls beyond the visible area */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-6 bg-gradient-to-r from-background to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-6 bg-gradient-to-l from-background to-transparent" />

      {/* Zoom controls */}
      <div className="absolute bottom-4 start-4 z-10 flex items-center gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => stepZoom(-1)}
          aria-label={t("roadmap.canvas.zoomOut")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title={t("roadmap.canvas.resetZoom")}
          className="min-w-12 rounded-lg px-1 text-[13px] font-medium tabular-nums text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {fmt.percent(zoom)}
        </button>
        <button
          type="button"
          onClick={() => stepZoom(1)}
          aria-label={t("roadmap.canvas.zoomIn")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <div className="h-5 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={fitView}
          aria-label={t("roadmap.canvas.fit")}
          title={t("roadmap.canvas.fit")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
