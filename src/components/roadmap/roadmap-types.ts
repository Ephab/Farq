import type { RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";

export interface RoadmapSnapshotData {
  title: string;
  nodes: RoadmapNodeData[];
  stages: RoadmapStage[];
}

export interface RoadmapOperation {
  type: "add_node" | "update_node" | "remove_node" | "move_node" | "set_dependencies";
  node_id: string;
  node?: RoadmapNodeData | null;
  changes?: Record<string, unknown> | null;
  stage_id?: string | null;
  position?: number | null;
  dependencies?: string[] | null;
}

export interface RoadmapProposalData {
  id: string;
  base_version_id: string;
  summary: string;
  reasoning: string;
  operations: RoadmapOperation[];
  kind: "ops" | "initial";
  snapshot: RoadmapSnapshotData | null;
  status: "pending" | "accepted" | "rejected" | string;
  created_at: string;
}

export interface RoadmapVersionSummary {
  id: string;
  version: number;
  reason: string;
  active: boolean;
  created_at: string;
  title: string;
  nodes: number;
  done: number;
}

/** A read-only look at something that is not (yet) the active roadmap. */
export type RoadmapPreview =
  | { kind: "version"; versionId: string; version: number; reason: string; active: boolean; snapshot: RoadmapSnapshotData }
  | { kind: "proposal"; proposal: RoadmapProposalData; snapshot: RoadmapSnapshotData };

export const PROTECTED = new Set(["done", "in-progress"]);
