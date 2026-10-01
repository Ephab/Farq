"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";
import { isOptionalNode, stripStagePrefix } from "@/lib/roadmap-layout";
import { RoadmapNode } from "@/components/roadmap/RoadmapNode";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

interface RoadmapCanvasProps {
  /** Hand-lettered at the top of the diagram, where the spine starts. */
  title?: string;
  nodes: RoadmapNodeData[];
  stages: RoadmapStage[];
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
  dimmedIds: Set<string>;
  onSelect: (id: string | null) => void;
  onToggleDone: (id: string) => void;
  onOpenProject?: (projectId: string) => void;
}

interface Group {
  stage: RoadmapStage;
  nodes: RoadmapNodeData[];
}

/**
 * A roadmap.sh-style diagram drawn in plain DOM. Each stage is a bright-yellow topic on a solid blue
 * spine; its subtopics stack in a column on each side and hang off it on dotted blue curves. The
 * curves are measured from the laid-out boxes, so they follow wrapping titles, RTL and resizes.
 * Below the container breakpoint the subtopics drop under their stage on a dotted rail.
 */
export function RoadmapCanvas({ title, nodes, stages, statuses, selectedId, dimmedIds, onSelect, onToggleDone, onOpenProject }: RoadmapCanvasProps) {
  const { t } = useI18n();

  const groups = useMemo<Group[]>(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const placed = new Set<string>();
    const result: Group[] = stages.map((stage) => {
      const members = stage.nodeIds.map((id) => byId.get(id)).filter((node): node is RoadmapNodeData => node !== undefined);
      members.forEach((node) => placed.add(node.id));
      return { stage, nodes: members };
    });
    // A node whose stage is missing must still be reachable.
    const orphans = nodes.filter((node) => !placed.has(node.id));
    if (orphans.length) result.push({ stage: { id: "__other", title: t("roadmap.canvas.otherTopics"), description: "", nodeIds: orphans.map((node) => node.id) }, nodes: orphans });
    return result;
  }, [nodes, stages, t]);

  // Keep the selected node in view.
  useEffect(() => {
    if (!selectedId) return;
    requestAnimationFrame(() => document.getElementById(`roadmap-node-${selectedId}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }));
  }, [selectedId]);

  const allDimmed = nodes.length > 0 && dimmedIds.size >= nodes.length;

  return (
    <div className="relative min-h-0 flex-1">
      <div className="rm-paper absolute inset-0 overflow-y-auto overscroll-contain" onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) onSelect(null) }}>
        <div role="list" aria-label={t("roadmap.canvas.ariaLabel")} className="@container relative mx-auto w-full max-w-[66rem] px-4 pb-28 pt-10 sm:px-8">
          {/* The spine: one solid blue line behind every stage, drawn top to bottom on first view. */}
          {title ? <p dir="auto" className="rm-hand rm-enter relative z-10 mx-auto mb-10 w-fit max-w-full bg-[var(--background)] px-4 text-center text-[28px] font-bold leading-tight text-foreground">{title}</p> : null}
          <div aria-hidden="true" className="rm-spine absolute bottom-28 top-14 start-1/2 hidden w-[3.5px] -translate-x-1/2 rounded-full bg-[#2b78e4] rtl:translate-x-1/2 @3xl:block" />

          {allDimmed ? (
            <div className="relative z-10 mx-auto mb-10 max-w-xs rounded-xl border border-border bg-background p-5 text-center">
              <p className="text-[15px] font-semibold">{t("roadmap.canvas.noMatchTitle")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("roadmap.canvas.noMatchBody")}</p>
            </div>
          ) : null}

          {groups.map((group, index) => (
            <StageSection
              key={group.stage.id}
              group={group}
              index={index}
              count={groups.filter((item) => item.stage.id !== "__other").length}
              statuses={statuses}
              selectedId={selectedId}
              dimmedIds={dimmedIds}
              onSelect={onSelect}
              onToggleDone={onToggleDone}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface StageSectionProps extends Pick<RoadmapCanvasProps, "statuses" | "selectedId" | "dimmedIds" | "onSelect" | "onToggleDone" | "onOpenProject"> {
  group: Group;
  index: number;
  count: number;
}

interface Curve { id: string; d: string; optional: boolean }

function StageSection({ group, index, count, statuses, selectedId, dimmedIds, onSelect, onToggleDone, onOpenProject }: StageSectionProps) {
  const { t, fmt } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [curves, setCurves] = useState<Curve[]>([]);

  const done = group.nodes.filter((node) => statuses[node.id] === "done").length;
  const total = group.nodes.length;
  const complete = total > 0 && done === total;
  const half = Math.ceil(total / 2);
  const columns = [group.nodes.slice(0, half), group.nodes.slice(half)];
  const optional = useMemo(() => new Set(group.nodes.filter(isOptionalNode).map((node) => node.id)), [group.nodes]);
  const nodeKey = group.nodes.map((node) => node.id).join("|");

  // Measure the boxes and draw one curve from the stage's side to each subtopic beside it.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    let frame = 0;
    const measure = () => {
      const base = section.getBoundingClientRect();
      const box = stage.getBoundingClientRect();
      const next: Curve[] = [];
      section.querySelectorAll<HTMLElement>("[data-roadmap-node]").forEach((element) => {
        const rect = element.getBoundingClientRect();
        const toStart = rect.right <= box.left;
        const toEnd = rect.left >= box.right;
        if (!toStart && !toEnd) return; // stacked under the stage: the dotted rail connects it instead
        const x0 = (toStart ? box.left : box.right) - base.left;
        const y0 = box.top + box.height / 2 - base.top;
        const x1 = (toStart ? rect.right : rect.left) - base.left;
        const y1 = rect.top + rect.height / 2 - base.top;
        const bend = (x0 + x1) / 2;
        const id = element.dataset.roadmapNode ?? "";
        next.push({ id, d: `M${x0.toFixed(1)} ${y0.toFixed(1)} C${bend.toFixed(1)} ${y0.toFixed(1)} ${bend.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`, optional: optional.has(id) });
      });
      setCurves(next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(section);
    // The hand-lettered face can arrive after first paint and change every box's width.
    void document.fonts?.ready.then(schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [nodeKey, optional]);

  const renderNode = (node: RoadmapNodeData, order: number) => {
    const status = statuses[node.id] ?? "not-started";
    const locked = status === "not-started" && node.deps.some((dep) => statuses[dep] !== undefined && statuses[dep] !== "done");
    return (
      <div key={node.id} role="listitem" className="rm-enter" style={{ animationDelay: `${180 + order * 45}ms` }}>
        <RoadmapNode node={node} status={status} locked={locked} selected={selectedId === node.id} dimmed={dimmedIds.has(node.id)} onSelect={onSelect} onToggleDone={onToggleDone} onOpenProject={onOpenProject} />
      </div>
    );
  };

  const title = stripStagePrefix(group.stage.title);
  return (
    <section ref={sectionRef} aria-label={title} className={cn("relative", index > 0 && "mt-16 @3xl:mt-20")}>
      {curves.length ? (
        <svg aria-hidden="true" className="rm-curves pointer-events-none absolute inset-0 size-full overflow-visible">
          {curves.map((curve) => (
            <path key={curve.id} d={curve.d} fill="none" stroke="#2b78e4" strokeWidth={3.5} strokeLinecap="round" strokeDasharray={curve.optional ? "0.8 14" : "0.8 8"} className={cn(dimmedIds.has(curve.id) && "opacity-25")} />
          ))}
        </svg>
      ) : null}

      {/* Narrow containers: a short stretch of spine leads into each stage after the first. */}
      {index > 0 ? <div aria-hidden="true" className="mx-auto -mt-10 mb-4 h-6 w-[3.5px] rounded-full bg-[#2b78e4] @3xl:hidden" /> : null}

      <div className="grid items-center gap-y-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,17rem)_minmax(0,1fr)] @3xl:gap-x-20">
        <div ref={stageRef} className="relative z-10 @3xl:col-start-2 @3xl:row-start-1">
          <div
            className="rm-enter relative rounded-[5px] border-[2.7px] border-black bg-[#fdff00] px-4 py-3 text-center text-black"
            style={{ animationDelay: `${index ? 120 : 60}ms` }}
            title={group.stage.description || undefined}
          >
            {group.stage.id === "__other" ? null : <p className="rm-hand text-[12px] text-black/60">{t("roadmap.canvas.stageOf", { index: fmt.number(index + 1), total: fmt.number(count) })}</p>}
            <h2 dir="auto" className="rm-hand text-[19px] font-bold leading-tight">{title}</h2>
            {total ? (
              <p className="rm-hand mt-1 text-[13px] tabular-nums text-black/65">{t("roadmap.canvas.stageDone", { done: fmt.number(done), total: fmt.number(total) })}</p>
            ) : null}
            {complete ? (
              <span className="rm-badge absolute -end-2.5 -top-2.5 grid size-6 place-items-center rounded-full border-2 border-black bg-[#22c55e] text-white" aria-hidden="true">
                <Check className="size-3.5" strokeWidth={3.5} />
              </span>
            ) : null}
          </div>
        </div>

        {total === 0 ? (
          <div className="rm-hand mx-auto w-full max-w-64 rounded-[5px] border-[2.7px] border-dashed border-black/40 px-3 py-3 text-center text-sm text-muted-foreground motion-safe:animate-pulse @3xl:col-start-2">{t("roadmap.canvas.building")}</div>
        ) : null}

        {columns.map((column, side) => column.length ? (
          <div
            key={side}
            role="list"
            className={cn(
              "flex flex-col gap-3 border-s-[3.5px] border-dotted border-[#2b78e4] ps-5",
              "@3xl:row-start-1 @3xl:border-0 @3xl:ps-0",
              side === 0 ? "@3xl:col-start-1" : "@3xl:col-start-3",
            )}
          >
            {column.map((node, order) => renderNode(node, side * half + order))}
          </div>
        ) : null)}
      </div>
    </section>
  );
}
