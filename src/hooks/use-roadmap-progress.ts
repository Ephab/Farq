"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NODES, type NodeStatus } from "@/data/computer-vision-roadmap";

const STORAGE_KEY = "farq-cv-roadmap-progress-v1";

function loadInitial(): Record<string, NodeStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, NodeStatus>;
    const valid: Record<string, NodeStatus> = {};
    for (const node of NODES) {
      const s = parsed[node.id];
      if (s === "done" || s === "in-progress" || s === "not-started") {
        valid[node.id] = s;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

export function statusOf(
  map: Record<string, NodeStatus>,
  id: string,
): NodeStatus {
  return map[id] ?? "not-started";
}

export function useRoadmapProgress() {
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>(loadInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
    } catch {
      // storage unavailable (private mode) — progress just won't persist
    }
  }, [statuses]);

  const setStatus = useCallback((id: string, status: NodeStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  const cycleStatus = useCallback((id: string) => {
    setStatuses((prev) => {
      const current = prev[id] ?? "not-started";
      const next: NodeStatus =
        current === "not-started"
          ? "in-progress"
          : current === "in-progress"
            ? "done"
            : "not-started";
      return { ...prev, [id]: next };
    });
  }, []);

  const reset = useCallback(() => setStatuses({}), []);

  const summary = useMemo(() => {
    let done = 0;
    let inProgress = 0;
    for (const node of NODES) {
      const s = statuses[node.id] ?? "not-started";
      if (s === "done") done += 1;
      else if (s === "in-progress") inProgress += 1;
    }
    return {
      done,
      inProgress,
      total: NODES.length,
      percent: NODES.length === 0 ? 0 : Math.round((done / NODES.length) * 100),
    };
  }, [statuses]);

  return { statuses, setStatus, cycleStatus, reset, summary };
}
