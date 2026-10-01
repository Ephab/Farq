"use client";

import { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";
import { stripStagePrefix } from "@/lib/roadmap-layout";
import { RoadmapNode } from "@/components/roadmap/RoadmapNode";
import { cn } from "@/lib/utils";
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
}

interface Group {
  stage: RoadmapStage;
  nodes: RoadmapNodeData[];
}

/** Optional work (a hackathon, a loose resource) hangs off the spine on a dashed line. */
const isOptional = (node: RoadmapNodeData) => node.nodeType === "opportunity" || node.nodeType === "resource";

/**
 * A vertical flow in the style of roadmap.sh: the stages are the bold boxes on a central spine and
 * their topics branch off to both sides as lighter boxes. Below the container-query breakpoint the
 * spine moves to the start edge and every topic sits in one column. Logical properties (start/end)
 * make the same markup mirror itself in RTL.
 */
export function RoadmapCanvas({ nodes, stages, statuses, selectedId, dimmedIds, onSelect, onToggleDone, onOpenProject }: RoadmapCanvasProps) {
  const { t, fmt } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

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
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overscroll-contain" onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) onSelect(null) }}>
        <div role="list" aria-label={t("roadmap.canvas.ariaLabel")} className="@container relative mx-auto w-full max-w-[56rem] px-4 pb-24 pt-8 sm:px-6">
          {/* The spine */}
          <div aria-hidden="true" className="absolute bottom-24 top-10 start-[calc(1rem+0.875rem)] w-0.5 rounded-full bg-border sm:start-[calc(1.5rem+0.875rem)] @2xl:start-1/2 @2xl:-translate-x-1/2" />

          {allDimmed ? (
            <div className="relative z-10 mx-auto mb-8 max-w-xs rounded-2xl border border-border bg-background p-5 text-center">
              <p className="text-[15px] font-semibold">{t("roadmap.canvas.noMatchTitle")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("roadmap.canvas.noMatchBody")}</p>
            </div>
          ) : null}

          {groups.map((group, index) => {
            const done = group.nodes.filter((node) => statuses[node.id] === "done").length;
            const total = group.nodes.length;
            const complete = total > 0 && done === total;
            const rows: RoadmapNodeData[][] = [];
            for (let i = 0; i < group.nodes.length; i += 2) rows.push(group.nodes.slice(i, i + 2));
            return (
              <section key={group.stage.id} role="listitem" aria-label={stripStagePrefix(group.stage.title)} className={cn("relative", index > 0 && "mt-14")}>
                <div className="relative z-10 flex @2xl:justify-center">
                  <div className="w-full rounded-2xl bg-primary px-5 py-3.5 text-primary-foreground shadow-sm @2xl:max-w-sm @2xl:text-center">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70 @2xl:justify-center">
                      {complete ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : null}
                      {group.stage.id === "__other" ? t("roadmap.canvas.otherTopics") : t("roadmap.canvas.stageOf", { index: fmt.number(index + 1), total: fmt.number(groups.length) })}
                    </p>
                    <h2 dir="auto" className="mt-0.5 line-clamp-2 text-base font-semibold leading-snug">{stripStagePrefix(group.stage.title)}</h2>
                    {group.stage.description ? <p dir="auto" className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-75">{group.stage.description}</p> : null}
                    {total ? (
                      <div className="mt-2.5 flex items-center gap-2 @2xl:justify-center">
                        <div className="h-1 w-24 overflow-hidden rounded-full bg-primary-foreground/20"><div className="h-full rounded-full bg-primary-foreground transition-[width]" style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
                        <span className="text-[11px] tabular-nums opacity-75">{fmt.number(done)}/{fmt.number(total)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {total === 0 ? (
                  <div className="relative mt-8 grid grid-cols-[1.75rem_minmax(0,1fr)] @2xl:grid-cols-1">
                    <div className="col-start-2 rounded-xl border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground motion-safe:animate-pulse @2xl:col-start-1 @2xl:mx-auto @2xl:w-64">{t("roadmap.canvas.building")}</div>
                  </div>
                ) : null}

                {rows.map((row, rowIndex) => (
                  <div key={rowIndex} className="relative mt-6 grid grid-cols-[1.75rem_minmax(0,1fr)] gap-y-4 @2xl:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] @2xl:gap-y-0 first:mt-8">
                    {row.map((node, side) => {
                      const start = side === 0;
                      const status = statuses[node.id] ?? "not-started";
                      const locked = status === "not-started" && node.deps.some((dep) => statuses[dep] !== undefined && statuses[dep] !== "done");
                      return (
                        <div key={node.id} className={cn("col-start-2", start ? "@2xl:col-start-1 @2xl:row-start-1" : "@2xl:col-start-3 @2xl:row-start-1")}>
                          <div className={cn("relative w-full @2xl:max-w-[19rem]", start ? "@2xl:ms-auto" : "@2xl:me-auto")}>
                            {/* Connector from the node to the spine (dashed when the work is optional). */}
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute top-1/2 -start-3.5 w-3.5 -translate-y-1/2 border-t-2",
                                isOptional(node) ? "border-dashed border-muted-foreground/50" : "border-border",
                                start ? "@2xl:start-auto @2xl:-end-9 @2xl:w-9" : "@2xl:-start-9 @2xl:w-9",
                              )}
                            />
                            <RoadmapNode
                              node={node}
                              status={status}
                              locked={locked}
                              selected={selectedId === node.id}
                              dimmed={dimmedIds.has(node.id)}
                              onSelect={onSelect}
                              onToggleDone={onToggleDone}
                              onOpenProject={onOpenProject}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
