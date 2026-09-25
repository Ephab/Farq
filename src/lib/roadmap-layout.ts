import type { RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

export interface StageAnchor {
  stageId: string;
  x: number;
  y: number;
}

export interface RoadmapEdge {
  id: string;
  from: string;
  to: string;
}

export interface RoadmapLayout {
  positions: Record<string, PositionedNode>;
  edges: RoadmapEdge[];
  stageAnchors: StageAnchor[];
  width: number;
  height: number;
  /** Vertical spine x in canvas coordinates. */
  spineX: number;
}

export const NODE_W = 272;
export const NODE_H = 120;
const GAP_X = 56;
const GAP_Y = 28;
const STAGE_HEADER_H = 92;
const STAGE_GAP = 64;
const PAD_X = 48;
const PAD_TOP = 32;
const PAD_BOTTOM = 48;
const COLS = 3;

/**
 * Deterministic vertical layout: stages stack top→bottom, the first node
 * of each stage sits centered under its header and the rest fan out in
 * rows of three (or left+right when exactly two remain, to frame the spine).
 * Canvas width/height derive from the content, so the canvas always fits
 * the roadmap no matter how many nodes it holds.
 */
export function computeRoadmapLayout(
  nodes: RoadmapNodeData[],
  stages: RoadmapStage[],
  compact = false,
): RoadmapLayout {
  const cols = compact ? 1 : COLS;
  const width = compact
    ? NODE_W + PAD_X * 2
    : COLS * NODE_W + (COLS - 1) * GAP_X + PAD_X * 2;
  const spineX = width / 2;

  const positions: Record<string, PositionedNode> = {};
  const stageAnchors: StageAnchor[] = [];
  let y = PAD_TOP;

  for (const stage of stages) {
    stageAnchors.push({ stageId: stage.id, x: spineX, y });
    y += STAGE_HEADER_H;

    const ids = stage.nodeIds.filter((id) => nodes.some((n) => n.id === id));
    const gridLeft = (width - (cols * NODE_W + (cols - 1) * GAP_X)) / 2;

    ids.forEach((id, i) => {
      let row = 0;
      let col = 0;
      if (compact) {
        row = i;
        col = 0;
      } else if (i === 0) {
        row = 0;
        col = 1;
      } else {
        const remaining = ids.length - 1;
        const seq = i - 1;
        if (remaining === 2) {
          row = 1;
          col = seq === 0 ? 0 : 2;
        } else {
          row = 1 + Math.floor(seq / COLS);
          col = seq % COLS;
        }
      }
      positions[id] = {
        id,
        x: gridLeft + col * (NODE_W + GAP_X),
        y: y + row * (NODE_H + GAP_Y),
      };
    });

    const rowsUsed = compact
      ? ids.length
      : ids.length <= 1
        ? 1
        : ids.length - 1 === 2
          ? 2
          : 1 + Math.ceil((ids.length - 1) / COLS);
    y += rowsUsed * NODE_H + (rowsUsed - 1) * GAP_Y + STAGE_GAP;
  }

  const height = y - STAGE_GAP + PAD_BOTTOM;

  // The vertical spine communicates progression between stages. Drawing every
  // prerequisite across stage boundaries produces long wires that cut through
  // headers and unrelated cards (and becomes especially noisy on generated
  // roadmaps). Keep explicit connectors for branching inside a stage only.
  const stageByNode = new Map<string, string>();
  for (const stage of stages) {
    for (const nodeId of stage.nodeIds) stageByNode.set(nodeId, stage.id);
  }

  const edges: RoadmapEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.deps) {
      if (
        positions[dep]
        && positions[node.id]
        && stageByNode.get(dep) === stageByNode.get(node.id)
      ) {
        edges.push({ id: `${dep}->${node.id}`, from: dep, to: node.id });
      }
    }
  }

  return { positions, edges, stageAnchors, width, height, spineX };
}

/**
 * Connect two cards at the edges that face one another.
 *
 * A stage can contain a horizontal sequence as well as vertical progression.
 * Always using bottom → top anchors made horizontal dependencies loop beneath
 * their cards and made the SVG look detached from the UI.
 */
export function edgePath(ax: number, ay: number, bx: number, by: number): string {
  const sourceCenterX = ax + NODE_W / 2;
  const sourceCenterY = ay + NODE_H / 2;
  const targetCenterX = bx + NODE_W / 2;
  const targetCenterY = by + NODE_H / 2;
  const mostlyHorizontal = Math.abs(targetCenterY - sourceCenterY) < NODE_H * 0.65;

  if (mostlyHorizontal) {
    const movingRight = targetCenterX >= sourceCenterX;
    const x1 = movingRight ? ax + NODE_W : ax;
    const x2 = movingRight ? bx : bx + NODE_W;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${sourceCenterY} C ${midX} ${sourceCenterY}, ${midX} ${targetCenterY}, ${x2} ${targetCenterY}`;
  }

  const movingDown = targetCenterY >= sourceCenterY;
  const y1 = movingDown ? ay + NODE_H : ay;
  const y2 = movingDown ? by : by + NODE_H;
  const midY = (y1 + y2) / 2;
  return `M ${sourceCenterX} ${y1} C ${sourceCenterX} ${midY}, ${targetCenterX} ${midY}, ${targetCenterX} ${y2}`;
}
