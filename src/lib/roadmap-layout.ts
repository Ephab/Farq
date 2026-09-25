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
  /** Cross-stage vertical channel (0 = outermost). Unused for intra-stage. */
  lane: number;
  /** Offset from the source bottom-center X for the exit stub. */
  exitDx: number;
  /** Offset from the target top-center X for the entry stub. */
  entryDx: number;
  /** Extra downward offset for the exit jog. */
  exitDy: number;
  /** Extra upward offset for the entry jog. */
  entryDy: number;
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
  // by design. Intra-stage deps draw direct beziers; cross-stage deps are
  // routed via a right-side channel so they never cut through headers or
  // unrelated cards (see crossStagePath).
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
          lane: 0,
          exitDx: 0,
          entryDx: 0,
          exitDy: 0,
          entryDy: 0,
        });
      }
    }
  }

  assignCrossStageRouting(edges, positions, stages, compact);

  // Cross-stage connectors first so intra-stage wires paint on top.
  edges.sort((a, b) => Number(a.crossStage) - Number(b.crossStage));

  return { positions, edges, stageAnchors, width, height, spineX };
}

/**
 * Spread cross-stage connectors so parallel wires never lie exactly on top
 * of each other. Fan-out from one source spreads along its bottom edge,
 * fan-in to one target spreads along its top edge, same-row exits stagger
 * vertically, and overlapping vertical runs get separate padding channels.
 */
function assignCrossStageRouting(
  edges: RoadmapEdge[],
  positions: Record<string, PositionedNode>,
  stages: RoadmapStage[],
  compact: boolean,
): void {
  const cross = edges.filter((e) => e.crossStage);
  if (cross.length === 0) return;

  // Last-row sources have a 64px stage gap below them; mid-stage sources
  // only have a 28px row gap before the next row starts.
  const stageMaxY = new Map<string, number>();
  for (const stage of stages) {
    let max = -Infinity;
    for (const id of stage.nodeIds) {
      const p = positions[id];
      if (p) max = Math.max(max, p.y);
    }
    stageMaxY.set(stage.id, max);
  }
  const stageByNode = new Map<string, string>();
  for (const stage of stages) {
    for (const nodeId of stage.nodeIds) stageByNode.set(nodeId, stage.id);
  }

  // Fan-out: spread exit stubs across the source bottom edge.
  const byFrom = new Map<string, RoadmapEdge[]>();
  for (const e of cross) {
    const list = byFrom.get(e.from) ?? [];
    list.push(e);
    byFrom.set(e.from, list);
  }
  for (const list of byFrom.values()) {
    list.sort((a, b) => a.to.localeCompare(b.to));
    list.forEach((e, i) => {
      const k = list.length;
      e.exitDx = k === 1 ? 0 : (i - (k - 1) / 2) * 56;
      e.exitDx = Math.max(-96, Math.min(96, e.exitDx));
    });
  }

  // Fan-in: spread entry stubs across the target top edge.
  const byTo = new Map<string, RoadmapEdge[]>();
  for (const e of cross) {
    const list = byTo.get(e.to) ?? [];
    list.push(e);
    byTo.set(e.to, list);
  }
  for (const list of byTo.values()) {
    list.sort((a, b) => a.from.localeCompare(b.from));
    list.forEach((e, i) => {
      const k = list.length;
      e.entryDx = k === 1 ? 0 : (i - (k - 1) / 2) * 56;
      e.entryDx = Math.max(-96, Math.min(96, e.entryDx));
    });
  }

  // Same-row exits share a jog level — stagger them so parallel horizontals
  // separate instead of coinciding.
  const byExitY = new Map<number, RoadmapEdge[]>();
  for (const e of cross) {
    const y1 = positions[e.from].y + NODE_H;
    const list = byExitY.get(y1) ?? [];
    list.push(e);
    byExitY.set(y1, list);
  }
  for (const [, list] of byExitY) {
    list.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    const lastRow = list.some((e) => {
      const stageId = stageByNode.get(e.from);
      return stageId !== undefined && positions[e.from].y >= (stageMaxY.get(stageId) ?? Infinity);
    });
    const cap = lastRow ? 28 : 8;
    list.forEach((e, i) => {
      e.exitDy = Math.min(i * 7, cap);
    });
  }

  // Same-target-row entries share a jog level — stagger them.
  const byEntryY = new Map<number, RoadmapEdge[]>();
  for (const e of cross) {
    const y2 = positions[e.to].y;
    const list = byEntryY.get(y2) ?? [];
    list.push(e);
    byEntryY.set(y2, list);
  }
  for (const list of byEntryY.values()) {
    list.sort((a, b) => a.from.localeCompare(b.from));
    list.forEach((e, i) => {
      e.entryDy = Math.min(i * 5, 8);
    });
  }

  // Separate vertical channels for runs whose Y ranges overlap (greedy
  // interval coloring). Compact mode only has room for one padding channel.
  const maxLanes = compact ? 1 : 3;
  const withSpan = cross
    .map((e) => ({
      e,
      yExit: positions[e.from].y + NODE_H + 18 + e.exitDy,
      yEntry: positions[e.to].y - 6 - e.entryDy,
    }))
    .sort((a, b) => a.yExit - b.yExit);
  const laneEnd: number[] = [];
  for (const { e, yExit, yEntry } of withSpan) {
    let placed = -1;
    for (let lane = 0; lane < Math.min(maxLanes, laneEnd.length + 1); lane++) {
      if (lane >= laneEnd.length || laneEnd[lane] + 6 < yExit) {
        placed = lane;
        break;
      }
    }
    if (placed === -1) placed = 0;
    e.lane = placed;
    laneEnd[placed] = Math.max(laneEnd[placed] ?? -Infinity, yEntry);
  }
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

/**
 * Orthogonal connector for cross-stage dependencies.
 *
 * A direct bezier from the end of one stage to the start of the next cuts
 * diagonally through the stage header card. Instead this routes: down from
 * the source, across (in the gap above the next header) to a padding
 * channel, vertically past headers/cards, then back across (in the small
 * gap below the header) into the top of the target.
 *
 * Callers spread parallel wires via lane/exitDx/entryDx/exitDy/entryDy
 * (see assignCrossStageRouting) so coincident lines separate into distinct
 * traceable paths. Corners are rounded so overlapping jogs stay readable.
 */
export function crossStageLaneX(canvasWidth: number, lane: number): number {
  return canvasWidth - 10 - lane * 14;
}

export function crossStagePath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  canvasWidth: number,
  opts?: { lane?: number; exitDx?: number; entryDx?: number; exitDy?: number; entryDy?: number },
): string {
  const lane = opts?.lane ?? 0;
  const exitDx = opts?.exitDx ?? 0;
  const entryDx = opts?.entryDx ?? 0;
  const exitDy = opts?.exitDy ?? 0;
  const entryDy = opts?.entryDy ?? 0;
  const sx = ax + NODE_W / 2 + exitDx;
  const tx = bx + NODE_W / 2 + entryDx;
  const y1 = ay + NODE_H;
  const y2 = by;

  // Moving up should never happen for cross-stage deps (wiring only allows
  // backwards deps), but fall back to a direct curve instead of looping.
  if (y2 <= y1) return edgePath(ax, ay, bx, by);

  const laneX = crossStageLaneX(canvasWidth, lane);
  // Horizontal jog above the header (stage gap is 64px) and the re-entry
  // just below it (header bottom sits ~12px above the first row).
  let yExit = y1 + 18 + exitDy;
  let yEntry = y2 - 6 - entryDy;
  if (yExit >= yEntry) {
    const mid = (y1 + y2) / 2;
    yExit = Math.min(yExit, mid);
    yEntry = Math.max(yEntry, mid + 1);
  }
  const pts: Array<[number, number]> = [
    [sx, y1],
    [sx, yExit],
    [laneX, yExit],
    [laneX, yEntry],
    [tx, yEntry],
    [tx, y2],
  ];
  return roundedOrthogonalPath(pts, 10);
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
