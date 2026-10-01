"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";

export function useRoadmapProgress(
  nodes: RoadmapNodeData[],
  initial: Record<string, NodeStatus>,
  persist: (id: string, status: NodeStatus) => Promise<void>,
  /** One write for many nodes (Reset). Parallel single writes overwrote each other on the server. */
  persistMany?: (statuses: Record<string, NodeStatus>) => Promise<void>,
) {
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>(initial);
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;

  useEffect(() => setStatuses(initial), [initial]);

  const setStatus = useCallback((id: string, status: NodeStatus) => {
    // Roll back to what the student saw just before this click, not to the last server load.
    const previous = statusesRef.current[id] ?? "not-started";
    setStatuses((current) => ({ ...current, [id]: status }));
    persist(id, status).catch(() => setStatuses((current) => ({ ...current, [id]: previous })));
  }, [persist]);

  const reset = useCallback(() => {
    const before = statusesRef.current;
    const cleared = Object.fromEntries(nodes.map((node) => [node.id, "not-started" as NodeStatus]));
    setStatuses(cleared);
    const write = persistMany
      ? persistMany(cleared)
      : nodes.reduce<Promise<void>>((chain, node) => chain.then(() => persist(node.id, "not-started")), Promise.resolve());
    write.catch(() => setStatuses(before));
  }, [nodes, persist, persistMany]);

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
