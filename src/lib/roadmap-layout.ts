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
  /** True when the dependency crosses a stage boundary. */
  crossStage: boolean;
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

  // Every declared dep gets a connector. Nodes with no deps stay separate
  // by design. Intra-stage deps draw direct beziers between cards.
  // Cross-stage deps are NOT drawn end-to-end: each involved node gets a
  // single short tap to the central spine (one line out of a source, one
  // line into a target no matter how many deps it has), and the spine
  // carries the continuity between stages. This keeps branching readable
  // instead of bundling parallel wires down one side of the canvas.
  // See RoadmapEdges for the tap rendering.
  const stageByNode = new Map<string, string>();
  for (const stage of stages) {
    for (const nodeId of stage.nodeIds) stageByNode.set(nodeId, stage.id);
  }

  const edges: RoadmapEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.deps) {
      if (positions[dep] && positions[node.id]) {
        edges.push({
          id: `${dep}->${node.id}`,
          from: dep,
          to: node.id,
          crossStage: stageByNode.get(dep) !== stageByNode.get(node.id),
        });
      }
    }
  }

  // Cross-stage connectors first so intra-stage wires paint on top.
  edges.sort((a, b) => Number(a.crossStage) - Number(b.crossStage));

  return { positions, edges, stageAnchors, width, height, spineX };
}

/**
 * Straight orthogonal connector between two cards.
 *
 * Horizontal neighbors join with a single straight segment between their
 * facing sides; anything else routes down/across/down with rounded corners
 * so every wire on the canvas is a straight line — no bezier curves.
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
    const y = (sourceCenterY + targetCenterY) / 2;
    return `M ${x1} ${y} L ${x2} ${y}`;
  }

  const movingDown = targetCenterY >= sourceCenterY;
  const y1 = movingDown ? ay + NODE_H : ay;
  const y2 = movingDown ? by : by + NODE_H;
  if (Math.abs(targetCenterX - sourceCenterX) < 1) {
    return `M ${sourceCenterX} ${y1} L ${targetCenterX} ${y2}`;
  }
  const midY = (y1 + y2) / 2;
  return roundedOrthogonalPath(
    [
      [sourceCenterX, y1],
      [sourceCenterX, midY],
      [targetCenterX, midY],
      [targetCenterX, y2],
    ],
    8,
  );
}

/**
 * Spine taps for cross-stage dependencies.
 *
 * Instead of drawing one wire per dependency (which bundles parallel lines
 * down one side of the canvas), each node involved in a cross-stage
 * dependency gets exactly one short tap to the central spine: sources tap
 * out of their bottom edge, targets tap in from above. The spine carries
 * continuity between stages, so fan-out reads as one line splitting and
 * fan-in as lines merging — no side channel, no overlapping bundles.
 */
export const TAP_EXIT_DY = 16;
export const TAP_ENTRY_DY = 8;

export function exitTapLevel(nodeTopY: number): number {
  return nodeTopY + NODE_H + TAP_EXIT_DY;
}

export function entryTapLevel(nodeTopY: number): number {
  return nodeTopY - TAP_ENTRY_DY;
}

export function exitTapPath(nodeX: number, nodeTopY: number, spineX: number): string {
  const sx = nodeX + NODE_W / 2;
  const y1 = nodeTopY + NODE_H;
  const yExit = exitTapLevel(nodeTopY);
  return roundedOrthogonalPath(
    [
      [sx, y1],
      [sx, yExit],
      [spineX, yExit],
    ],
    8,
  );
}

export function entryTapPath(nodeX: number, nodeTopY: number, spineX: number): string {
  const tx = nodeX + NODE_W / 2;
  const y2 = nodeTopY;
  const yEntry = entryTapLevel(nodeTopY);
  return roundedOrthogonalPath(
    [
      [spineX, yEntry],
      [tx, yEntry],
      [tx, y2],
    ],
    8,
  );
}

/** Polyline with quadratic rounded corners for orthogonal routing. */
function roundedOrthogonalPath(pts: Array<[number, number]>, radius: number): string {
  if (pts.length < 2) return "";
  // Collapse consecutive duplicates (spread of 0 can create zero-length runs).
  const clean: Array<[number, number]> = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = clean[clean.length - 1];
    if (Math.abs(pts[i][0] - prev[0]) > 0.01 || Math.abs(pts[i][1] - prev[1]) > 0.01) {
      clean.push(pts[i]);
    }
  }
  if (clean.length < 2) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${clean[0][0]} ${clean[0][1]}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const [x0, y0] = clean[i - 1];
    const [x1, y1] = clean[i];
    const [x2, y2] = clean[i + 1];
    const len1 = Math.hypot(x1 - x0, y1 - y0);
    const len2 = Math.hypot(x2 - x1, y2 - y1);
    const r = Math.max(0, Math.min(radius, len1 / 2, len2 / 2));
    if (r === 0) {
      d += ` L ${x1} ${y1}`;
      continue;
    }
    const dx1 = (x1 - x0) / (len1 || 1);
    const dy1 = (y1 - y0) / (len1 || 1);
    const dx2 = (x2 - x1) / (len2 || 1);
    const dy2 = (y2 - y1) / (len2 || 1);
    d += ` L ${x1 - dx1 * r} ${y1 - dy1 * r}`;
    d += ` Q ${x1} ${y1} ${x1 + dx2 * r} ${y1 + dy2 * r}`;
  }
  const last = clean[clean.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}
