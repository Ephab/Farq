"use client";

import { createElement, memo } from "react";
import { motion } from "motion/react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";
import { NODE_W } from "@/lib/roadmap-layout";
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
}: RoadmapNodeProps) {
  return (
    <motion.button
      type="button"
      id={`roadmap-node-${node.id}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: dimmed ? 0.35 : 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.4) }}
      onClick={() => onSelect(node.id)}
      aria-label={`${node.title} — ${status.replace("-", " ")}`}
      aria-pressed={selected}
      className={cn(
        "group absolute flex flex-col rounded-2xl border bg-background p-3 text-left shadow-sm outline-none transition-shadow hover:shadow-md",
        "focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary ring-2 ring-ring"
          : status === "done"
            ? "border-emerald-500/50"
            : status === "in-progress"
              ? "border-amber-500/50"
              : "border-border",
      )}
      style={{ left: x, top: y, width: NODE_W }}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            status === "done"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-foreground",
          )}
        >
          <RoadmapNodeIcon icon={node.icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {node.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {node.tagline}
          </span>
        </span>
        <span
          className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT[status])}
          aria-hidden="true"
        />
      </span>
      <span className="mt-2.5 flex items-center justify-between border-t border-border pt-2 text-[11px]">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            LEVEL_BADGE[node.level],
          )}
        >
          {node.level}
        </span>
        <span className="text-muted-foreground">{node.duration}</span>
        <span className="text-muted-foreground">
          {node.subtopics.length} topics
        </span>
      </span>
    </motion.button>
  );
});
