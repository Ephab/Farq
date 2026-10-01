"use client";

import { createElement, memo } from "react";
import { Check, Trophy } from "lucide-react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";
import { nodeIcon } from "@/components/roadmap/roadmap-icons";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export function RoadmapNodeIcon({ icon, className }: { icon: string; className?: string }) {
  return createElement(nodeIcon(icon), { className, "aria-hidden": true });
}

interface RoadmapNodeProps {
  node: RoadmapNodeData;
  status: NodeStatus;
  /** Not started and something it builds on is not done yet: drawn muted, still clickable. */
  locked: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onToggleDone: (id: string) => void;
  onOpenProject?: (projectId: string) => void;
}

/** A sub-topic: a light box hanging off the spine. Title and meta truncate; the detail panel has the full text. */
export const RoadmapNode = memo(function RoadmapNode({ node, status, locked, selected, dimmed, onSelect, onToggleDone, onOpenProject }: RoadmapNodeProps) {
  const { t } = useI18n();
  const isDone = status === "done";
  const isProject = node.nodeType === "project";
  const meta = [t(`roadmap.levels.${node.level}`), node.duration].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      id={`roadmap-node-${node.id}`}
      onClick={() => onSelect(node.id)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isProject && node.projectId) onOpenProject?.(node.projectId);
        else onToggleDone(node.id);
      }}
      onContextMenu={(event) => {
        // A long-press on touch screens is a context menu: it must never silently change progress.
        event.preventDefault();
        event.stopPropagation();
        if (isProject && node.projectId) onOpenProject?.(node.projectId);
        else onSelect(node.id);
      }}
      title={node.title}
      aria-label={t(isProject ? "roadmap.node.ariaProject" : isDone ? "roadmap.node.ariaMarkNotStarted" : "roadmap.node.ariaMarkDone", { title: node.title, status: t(`roadmap.status.${status}`) })}
      aria-pressed={selected}
      className={cn(
        "group flex min-h-14 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-start outline-none transition-[background-color,border-color,box-shadow,opacity] duration-150",
        "hover:border-foreground/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring",
        isDone && "border-emerald-500/40 bg-emerald-500/10",
        status === "in-progress" && "border-primary bg-card ring-1 ring-primary/25",
        status === "not-started" && (locked ? "border-border bg-muted/30" : "border-border bg-card"),
        selected && "ring-2 ring-ring",
        dimmed && "opacity-30",
      )}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", isDone ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-foreground/80")}>
        {node.nodeType === "opportunity" ? <Trophy className="size-4" aria-hidden="true" /> : <RoadmapNodeIcon icon={node.icon} className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className={cn("block truncate text-sm font-medium leading-tight", locked && "text-foreground/70")}>{node.title}</span>
        <span dir="auto" className="mt-0.5 block truncate text-xs text-muted-foreground"><bdi>{meta}</bdi></span>
      </span>
      {isDone ? (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white" aria-hidden="true"><Check className="size-3.5" strokeWidth={3} /></span>
      ) : status === "in-progress" ? (
        <span className="size-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
      ) : (
        <span className="size-2.5 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden="true" />
      )}
    </button>
  );
});
