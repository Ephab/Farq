"use client";

import { memo } from "react";
import type { NodeStatus } from "@/data/computer-vision-roadmap";
import {
  edgePath,
  spineBranchPath,
  type RoadmapLayout,
} from "@/lib/roadmap-layout";

interface RoadmapEdgesProps {
  layout: RoadmapLayout;
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
}

/** Connector layer: central spine + dependency bezier edges. */
export const RoadmapEdges = memo(function RoadmapEdges({
  layout,
  statuses,
  selectedId,
}: RoadmapEdgesProps) {
  const { positions, edges, spineX, width, height, stageAnchors } = layout;
  const top = stageAnchors.length > 0 ? stageAnchors[0].y : 0;

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

      {/* Spine branches to each node */}
      {Object.values(positions).map((p) => (
        <path
          key={`branch-${p.id}`}
          d={spineBranchPath(spineX, p.x, p.y)}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1.5}
        />
      ))}

      {/* Dependency edges */}
      {edges.map((e) => {
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;
        const sourceDone = statuses[e.from] === "done";
        const isActive =
          selectedId !== null && (e.from === selectedId || e.to === selectedId);
        return (
          <path
            key={e.id}
            d={edgePath(from.x, from.y, to.x, to.y)}
            fill="none"
            stroke={sourceDone ? "var(--primary)" : "var(--ring)"}
            strokeWidth={isActive ? 2.5 : 2}
            strokeOpacity={sourceDone || isActive ? 0.9 : 0.45}
          />
        );
      })}
    </svg>
  );
});
