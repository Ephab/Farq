"use client";

import { createElement, memo } from "react";
import { motion } from "motion/react";
import { Check, Trophy } from "lucide-react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";
import { NODE_H, NODE_W } from "@/lib/roadmap-layout";
import { nodeIcon } from "@/components/roadmap/roadmap-icons";
import { cn } from "@/lib/utils";

export function RoadmapNodeIcon({ icon, className }: { icon: string; className?: string }) {
  return createElement(nodeIcon(icon), { className, "aria-hidden": true });
}

const STATUS_DOT: Record<NodeStatus, string> = {
  "not-started": "bg-muted-foreground/40",
  "in-progress": "bg-amber-500",
  done: "bg-emerald-500",
};

const LEVEL_BADGE: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Intermediate: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  Advanced: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

interface RoadmapNodeProps {
  node: RoadmapNodeData;
  x: number;
  y: number;
  status: NodeStatus;
  selected: boolean;
  dimmed: boolean;
  index: number;
  onSelect: (id: string) => void;
  onToggleDone: (id: string) => void;
}

export const RoadmapNode = memo(function RoadmapNode({
  node,
  x,
  y,
  status,
  selected,
  dimmed,
  index,
  onSelect,
  onToggleDone,
}: RoadmapNodeProps) {
  const isDone = status === "done";
  const isOpportunity = node.nodeType === "opportunity";

  return (
    <motion.button
      type="button"
      id={`roadmap-node-${node.id}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: dimmed ? 0.35 : 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.4) }}
      onClick={() => onSelect(node.id)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleDone(node.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleDone(node.id);
      }}
      title="Click for details · Double-click or right-click to mark done"
      aria-label={`${node.title} — ${status.replace("-", " ")}. Double-click or right-click to ${isDone ? "mark not started" : "mark done"}.`}
      aria-pressed={selected}
      className={cn(
        "group absolute flex flex-col rounded-xl border p-3 text-left outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isDone
          ? "border-foreground bg-foreground text-background shadow-md"
          : selected
            ? "border-primary bg-background ring-2 ring-ring"
            : status === "in-progress"
              ? "border-amber-500/50 bg-background shadow-sm"
              : "border-border bg-background shadow-sm",
      )}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            isDone
              ? "bg-background/12 text-background"
              : "bg-muted text-foreground",
          )}
        >
          <RoadmapNodeIcon icon={node.icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">
            {node.title}
          </span>
          <span className={cn("mt-0.5 block truncate text-[13px]", isDone ? "text-background/65" : "text-muted-foreground")}>
            {node.tagline}
          </span>
        </span>
        {isDone ? (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background text-foreground" aria-hidden="true">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : (
          <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT[status])} aria-hidden="true" />
        )}
      </span>
      <span className={cn("mt-2.5 flex items-center justify-between border-t pt-2 text-xs", isDone ? "border-background/15" : "border-border")}>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            isDone ? "bg-background/12 text-background" : LEVEL_BADGE[node.level],
          )}
        >
          {isOpportunity ? <span className="flex items-center gap-1"><Trophy className="size-3" />Hackathon</span> : node.level}
        </span>
        <span className={isDone ? "text-background/60" : "text-muted-foreground"}>{node.duration}</span>
        <span className={isDone ? "text-background/60" : "text-muted-foreground"}>
          {node.subtopics.length} topics
        </span>
      </span>
    </motion.button>
  );
});
