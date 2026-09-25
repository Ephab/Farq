"use client";

import { memo } from "react";
import type { NodeStatus } from "@/data/computer-vision-roadmap";
import {
  NODE_W,
  crossStagePath,
  edgePath,
  type RoadmapLayout,
} from "@/lib/roadmap-layout";

interface RoadmapEdgesProps {
  layout: RoadmapLayout;
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
}

/** Connector layer: central spine + dependency edges (direct inside a stage, side-channel across stages). */
export const RoadmapEdges = memo(function RoadmapEdges({
  layout,
  statuses,
  selectedId,
}: RoadmapEdgesProps) {
  const { positions, edges, spineX, width, height, stageAnchors } = layout;
  const top = stageAnchors.length > 0 ? stageAnchors[0].y : 0;

  // Focus mode: when a node is selected, only its direct connections stay
  // prominent so a single path can be traced through dense branching.
  const connected = new Set<string>();
  if (selectedId !== null) {
    for (const e of edges) {
      if (e.from === selectedId || e.to === selectedId) connected.add(e.id);
    }
  }
  const focusing = selectedId !== null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
    >
      {/* Central spine */}
      <line
        x1={spineX}
        y1={top}
        x2={spineX}
        y2={height - 24}
        stroke="var(--border)"
        strokeWidth={2}
        strokeDasharray="2 8"
        strokeLinecap="round"
      />
      {stageAnchors.map((a) => (
        <circle key={a.stageId} cx={spineX} cy={a.y + 44} r={5} fill="var(--primary)" opacity={0.9} />
      ))}

      {/* Dependency edges */}
      {edges.map((e) => {
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;
        const sourceDone = statuses[e.from] === "done";
        const isActive = connected.has(e.id)
          || (selectedId !== null && (e.from === selectedId || e.to === selectedId));
        const isDimmed = focusing && !isActive;
        return (
          <g key={e.id}>
            <path
              d={
                e.crossStage
                  ? crossStagePath(from.x, from.y, to.x, to.y, width, {
                    lane: e.lane,
                    exitDx: e.exitDx,
                    entryDx: e.entryDx,
                    exitDy: e.exitDy,
                    entryDy: e.entryDy,
                  })
                  : edgePath(from.x, from.y, to.x, to.y)
              }
              fill="none"
              stroke={sourceDone ? "var(--foreground)" : "var(--muted-foreground)"}
              strokeWidth={isActive ? 2.75 : 2}
              strokeOpacity={
                isDimmed ? 0.07 : sourceDone ? 0.9 : isActive ? 0.85 : e.crossStage ? 0.4 : 0.3
              }
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {e.crossStage && !isDimmed ? (
              <circle
                cx={to.x + NODE_W / 2 + e.entryDx}
                cy={to.y - 5}
                r={isActive ? 3.5 : 2.5}
                fill={sourceDone ? "var(--foreground)" : "var(--muted-foreground)"}
                opacity={sourceDone ? 0.9 : isActive ? 0.85 : 0.45}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
});
