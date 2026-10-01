"use client";

import { createElement, memo } from "react";
import { Check, FolderGit2, Trophy } from "lucide-react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";
import { nodeIcon } from "@/components/roadmap/roadmap-icons";
import { isOptionalNode } from "@/lib/roadmap-layout";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export function RoadmapNodeIcon({ icon, className }: { icon: string; className?: string }) {
  return createElement(nodeIcon(icon), { className, "aria-hidden": true });
}

interface RoadmapNodeProps {
  node: RoadmapNodeData;
  status: NodeStatus;
  /** Not started and something it builds on is not done yet (announced in the tooltip). */
  locked: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onToggleDone: (id: string) => void;
  onOpenProject?: (projectId: string) => void;
}

/**
 * A subtopic in the roadmap.sh idiom: a pale-yellow box with a heavy ink outline and the title only.
 * Progress reads the way roadmap.sh shows it: done turns grey and is struck through, in progress turns
 * lavender and is underlined. Level and duration live in the tooltip and the detail panel.
 */
export const RoadmapNode = memo(function RoadmapNode({ node, status, locked, selected, dimmed, onSelect, onToggleDone, onOpenProject }: RoadmapNodeProps) {
  const { t } = useI18n();
  const isDone = status === "done";
  const learning = status === "in-progress";
  const isProject = node.nodeType === "project";
  const meta = [t(`roadmap.levels.${node.level}`), node.duration].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      id={`roadmap-node-${node.id}`}
      data-roadmap-node={node.id}
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
      title={`${node.title}\n${meta}${locked ? `\n${t("roadmap.node.lockedHint")}` : ""}`}
      aria-label={t(isProject ? "roadmap.node.ariaProject" : isDone ? "roadmap.node.ariaMarkNotStarted" : "roadmap.node.ariaMarkDone", { title: node.title, status: t(`roadmap.status.${status}`) })}
      aria-pressed={selected}
      className={cn(
        "rm-node group relative flex min-h-11 w-full items-center justify-center gap-2 rounded-[5px] border-[2.7px] border-black px-3 py-2 text-center text-black outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-[#2b78e4] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isDone ? "bg-[#cbcbcb]" : learning ? "bg-[#dad1fd]" : isOptionalNode(node) ? "bg-white" : "bg-[#ffe599]",
        selected && "ring-[3px] ring-[#2b78e4] ring-offset-2 ring-offset-background",
        dimmed && "opacity-25",
      )}
    >
      {isProject ? <FolderGit2 className="size-4 shrink-0" aria-hidden="true" /> : node.nodeType === "opportunity" ? <Trophy className="size-4 shrink-0" aria-hidden="true" /> : null}
      <span
        dir="auto"
        className={cn(
          "rm-hand min-w-0 text-[15px] leading-snug decoration-2 underline-offset-4",
          isDone && "line-through",
          learning && "underline",
        )}
      >
        {node.title}
      </span>
      {isDone ? (
        <span className="rm-badge absolute -end-2.5 -top-2.5 grid size-5 place-items-center rounded-full border-2 border-black bg-[#22c55e] text-white" aria-hidden="true">
          <Check className="size-3" strokeWidth={3.5} />
        </span>
      ) : learning ? (
        <span className="rm-badge absolute -end-2 -top-2 size-3.5 rounded-full border-2 border-black bg-[#7c5cf5]" aria-hidden="true" />
      ) : null}
    </button>
  );
});
