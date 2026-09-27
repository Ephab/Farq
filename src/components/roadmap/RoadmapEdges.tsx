"use client";

import { memo } from "react";
import type { NodeStatus } from "@/data/computer-vision-roadmap";
import {
  crossColumnPath,
  crossRowPath,
  edgePath,
  entryTapLevel,
  entryTapPath,
  exitTapLevel,
  exitTapPath,
  NODE_H,
  verticalWireChannel,
  type RoadmapLayout,
} from "@/lib/roadmap-layout";

interface RoadmapEdgesProps {
  layout: RoadmapLayout;
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
}

/** Connector layer: central spine + intra-stage beziers + single spine taps.
 *
 * Cross-stage deps never draw end-to-end wires. Each source gets one short
 * tap out of its bottom edge to the spine; each target gets one short tap
 * in from the spine. Fan-out reads as one line splitting, fan-in as lines
 * merging on the backbone. Selecting a node highlights its taps and the
 * spine stretch between them so the exact route stays traceable.
 */
export const RoadmapEdges = memo(function RoadmapEdges({
  layout,
  statuses,
  selectedId,
}: RoadmapEdgesProps) {
  const { positions, edges, spineX, width, height, stageAnchors } = layout;
  const top = stageAnchors.length > 0 ? stageAnchors[0].y : 0;

  const crossOut = new Set<string>();
  const crossIn = new Set<string>();
  for (const e of edges) {
    if (!e.crossStage) continue;
    crossOut.add(e.from);
    crossIn.add(e.to);
  }

  // Direct intra-stage neighbors stay prominent in focus mode.
  const connected = new Set<string>();
  // Cross-stage counterparts of the selection (exact dep pairs).
  const crossSources: string[] = [];
  const crossTargets: string[] = [];
  if (selectedId !== null) {
    for (const e of edges) {
      if (e.from === selectedId || e.to === selectedId) connected.add(e.id);
      if (e.crossStage && e.to === selectedId) crossSources.push(e.from);
      if (e.crossStage && e.from === selectedId) crossTargets.push(e.to);
    }
  }
  const focusing = selectedId !== null;
  const related = new Set<string>([
    ...(selectedId !== null ? [selectedId] : []),
    ...crossSources,
    ...crossTargets,
  ]);

  // Spine stretch linking the selection to its cross-stage counterparts.
  let spineHi: [number, number] | null = null;
  if (selectedId !== null && positions[selectedId]) {
    const levels: number[] = [];
    if (crossOut.has(selectedId)) levels.push(exitTapLevel(positions[selectedId].y));
    if (crossIn.has(selectedId)) levels.push(entryTapLevel(positions[selectedId].y));
    for (const id of crossSources) {
      const p = positions[id];
      if (p) levels.push(exitTapLevel(p.y));
    }
    for (const id of crossTargets) {
      const p = positions[id];
      if (p) levels.push(entryTapLevel(p.y));
    }
    if (levels.length >= 2) spineHi = [Math.min(...levels), Math.max(...levels)];
  }

  const exitActive = (id: string) =>
    selectedId !== null && (id === selectedId || crossSources.includes(id));
  const entryActive = (id: string) =>
    selectedId !== null && (id === selectedId || crossTargets.includes(id));

  // Horizontal view: every dep draws as a direct orthogonal wire, which
  // reads cleanly when the whole graph flows left→right. No spine or taps.
  if (layout.orientation === "horizontal") {
    return (
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0"
        width={width}
        height={height}
      >
        {edges.map((e) => {
          const from = positions[e.from];
          const to = positions[e.to];
          if (!from || !to) return null;
          const sourceDone = statuses[e.from] === "done";
          const isActive = connected.has(e.id);
          const isDimmed = focusing && !isActive;
          // Same-column neighbours drop straight down; anything else rides
          // the gaps and the bottom bus lane, never through cards.
          const d = Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < NODE_H * 1.5
            ? edgePath(from.x, from.y, to.x, to.y)
            : crossColumnPath(from.x, from.y, to.x, to.y, height - 24);
          return (
            <path
              key={e.id}
              d={d}
              fill="none"
              stroke={isActive ? "var(--primary)" : sourceDone ? "var(--foreground)" : "var(--muted-foreground)"}
              strokeWidth={isActive ? 2.75 : 2}
              strokeOpacity={isDimmed ? 0.07 : sourceDone ? 0.9 : isActive ? 0.85 : 0.45}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
    >
      {/* Central spine — solid, same weight as the taps feeding it */}
      <line
        x1={spineX}
        y1={top}
        x2={spineX}
        y2={height - 24}
        stroke="var(--muted-foreground)"
        strokeWidth={2}
        strokeOpacity={0.5}
        strokeLinecap="round"
      />
      {spineHi ? (
        <line
          x1={spineX}
          y1={spineHi[0]}
          x2={spineX}
          y2={spineHi[1]}
          stroke="var(--primary)"
          strokeWidth={3}
          strokeLinecap="round"
          opacity={0.85}
        />
      ) : null}
      {stageAnchors.map((a) => (
        <circle key={a.stageId} cx={spineX} cy={a.y + 44} r={5} fill="var(--primary)" opacity={0.9} />
      ))}

      {/* Cross-stage exit taps: one line out per source, whatever the fan-out */}
      {[...crossOut].map((id) => {
        const p = positions[id];
        if (!p) return null;
        const active = exitActive(id);
        const dimmed = focusing && !related.has(id);
        const done = statuses[id] === "done";
        return (
          <g key={`out-${id}`}>
            <path
              d={exitTapPath(p.x, p.y, spineX)}
              fill="none"
              stroke={active ? "var(--primary)" : done ? "var(--foreground)" : "var(--muted-foreground)"}
              strokeWidth={active ? 2.75 : 2}
              strokeOpacity={dimmed ? 0.07 : active || done ? 0.9 : 0.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={spineX}
              cy={exitTapLevel(p.y)}
              r={active ? 3.5 : 2.75}
              fill={active ? "var(--primary)" : done ? "var(--foreground)" : "var(--muted-foreground)"}
              opacity={dimmed ? 0.07 : active || done ? 0.9 : 0.5}
            />
          </g>
        );
      })}

      {/* Cross-stage entry taps: one line in per target, whatever the fan-in */}
      {[...crossIn].map((id) => {
        const p = positions[id];
        if (!p) return null;
        const active = entryActive(id);
        const dimmed = focusing && !related.has(id);
        return (
          <g key={`in-${id}`}>
            <path
              d={entryTapPath(p.x, p.y, spineX)}
              fill="none"
              stroke={active ? "var(--primary)" : "var(--muted-foreground)"}
              strokeWidth={active ? 2.75 : 2}
              strokeOpacity={dimmed ? 0.07 : active ? 0.9 : 0.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={spineX}
              cy={entryTapLevel(p.y)}
              r={active ? 3.5 : 2.75}
              fill={active ? "var(--primary)" : "var(--muted-foreground)"}
              opacity={dimmed ? 0.07 : active ? 0.9 : 0.5}
            />
          </g>
        );
      })}

      {/* Intra-stage dependency edges */}
      {edges.map((e) => {
        if (e.crossStage) return null;
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;
        const sourceDone = statuses[e.from] === "done";
        const isActive = connected.has(e.id);
        const isDimmed = focusing && !isActive;
        // Neighbours wire straight; multi-row jumps ride the column gaps.
        const d = Math.abs(from.y - to.y) < NODE_H * 1.5
          ? edgePath(from.x, from.y, to.x, to.y)
          : crossRowPath(from.x, from.y, to.x, to.y, verticalWireChannel(from.x, width));
        return (
          <path
            key={e.id}
            d={d}
            fill="none"
            stroke={sourceDone ? "var(--foreground)" : "var(--muted-foreground)"}
            strokeWidth={isActive ? 2.75 : 2}
            strokeOpacity={isDimmed ? 0.07 : sourceDone ? 0.9 : isActive ? 0.85 : 0.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
});
