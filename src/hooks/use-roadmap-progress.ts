"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";

export function useRoadmapProgress(
  nodes: RoadmapNodeData[],
  initial: Record<string, NodeStatus>,
  persist: (id: string, status: NodeStatus) => Promise<void>,
) {
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>(initial);

  useEffect(() => setStatuses(initial), [initial]);

  const setStatus = useCallback((id: string, status: NodeStatus) => {
    setStatuses((previous) => ({ ...previous, [id]: status }));
    persist(id, status).catch(() => setStatuses((previous) => ({ ...previous, [id]: initial[id] ?? "not-started" })));
  }, [initial, persist]);

  const reset = useCallback(() => {
    const cleared = Object.fromEntries(nodes.map((node) => [node.id, "not-started" as NodeStatus]));
    setStatuses(cleared);
    void Promise.all(nodes.map((node) => persist(node.id, "not-started")));
  }, [nodes, persist]);

  const summary = useMemo(() => {
    let done = 0;
    let inProgress = 0;
    for (const node of nodes) {
      const status = statuses[node.id] ?? "not-started";
      if (status === "done") done += 1;
      else if (status === "in-progress") inProgress += 1;
    }
    return { done, inProgress, total: nodes.length, percent: nodes.length ? Math.round((done / nodes.length) * 100) : 0 };
  }, [nodes, statuses]);

  return { statuses, setStatus, reset, summary };
}
