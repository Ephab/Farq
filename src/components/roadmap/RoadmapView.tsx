"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NODES, STAGES, type NodeStatus, type RoadmapNodeData, type RoadmapStage } from "@/data/computer-vision-roadmap";
import { useRoadmapProgress } from "@/hooks/use-roadmap-progress";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { RoadmapHeader, type LevelFilter } from "@/components/roadmap/RoadmapHeader";
import { NodeDetailPanel } from "@/components/roadmap/NodeDetailPanel";
import { api, getCurrentStudentId, ROADMAP_CHANGED_EVENT } from "@/lib/farq-api";

interface RoadmapResponse {
  version: number;
  snapshot: { title: string; nodes: RoadmapNodeData[]; stages: RoadmapStage[] };
}

export function RoadmapView() {
  const [nodes, setNodes] = useState<RoadmapNodeData[]>(NODES);
  const [stages, setStages] = useState<RoadmapStage[]>(STAGES);
  const [version, setVersion] = useState<number | null>(null);
  const [title, setTitle] = useState("Computer Vision Roadmap");
  const studentId = getCurrentStudentId();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelFilter>("All");

  const initialStatuses = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node.status ?? "not-started"])) as Record<string, NodeStatus>, [nodes]);
  const persist = useCallback(async (id: string, status: NodeStatus) => {
    await api(`/api/students/${studentId}/roadmap/nodes/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
  }, [studentId]);
  const { statuses, setStatus, reset, summary } = useRoadmapProgress(nodes, initialStatuses, persist);

  useEffect(() => {
    const load = () => api<RoadmapResponse>(`/api/students/${studentId}/roadmap`).then((response) => {
      setNodes(response.snapshot.nodes); setStages(response.snapshot.stages); setVersion(response.version); setTitle(response.snapshot.title); setLoadError(null);
    }).catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : "Could not load the persistent roadmap"));
    void load();
    // Accepting a proposal anywhere (Hermes Coach, onboarding) creates a new version.
    window.addEventListener(ROADMAP_CHANGED_EVENT, load);
    return () => window.removeEventListener(ROADMAP_CHANGED_EVENT, load);
  }, [studentId]);

  const dimmedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dimmed = new Set<string>();
    for (const node of nodes) {
      if (level !== "All" && node.level !== level) { dimmed.add(node.id); continue; }
      if (q && !`${node.title} ${node.tagline} ${node.description} ${node.subtopics.join(" ")}`.toLowerCase().includes(q)) dimmed.add(node.id);
    }
    return dimmed;
  }, [nodes, query, level]);

  const nodeMap = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = selectedId ? (nodeMap[selectedId] ?? null) : null;
  const selectedIndex = selectedNode ? nodes.findIndex((node) => node.id === selectedNode.id) : -1;

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const step = (direction: 1 | -1) => {
    const next = selectedIndex + direction;
    if (next >= 0 && next < nodes.length) setSelectedId(nodes[next].id);
  };

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-none flex-col overflow-hidden bg-background">
      <RoadmapHeader title={title} done={summary.done} total={summary.total} percent={summary.percent} query={query} onQuery={setQuery} level={level} onLevel={setLevel} onReset={reset} />
      {version ? <div className="border-b border-border px-6 py-1.5 text-right text-[11px] text-muted-foreground">Personal roadmap · version {version}</div> : null}
      {loadError ? <div className="border-b border-amber-500/30 bg-amber-500/5 px-6 py-2 text-xs text-amber-700">Backend unavailable: showing the bundled roadmap. {loadError}</div> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <RoadmapCanvas
          nodes={nodes}
          stages={stages}
          statuses={statuses}
          selectedId={selectedId}
          dimmedIds={dimmedIds}
          onSelect={setSelectedId}
          onToggleDone={(id) => setStatus(id, statuses[id] === "done" ? "not-started" : "done")}
        />
        <NodeDetailPanel node={selectedNode} status={selectedId ? (statuses[selectedId] ?? "not-started") : "not-started"} hasPrev={selectedIndex > 0} hasNext={selectedIndex >= 0 && selectedIndex < nodes.length - 1} onStatus={(status) => selectedId && setStatus(selectedId, status)} onClose={() => setSelectedId(null)} onNavigate={setSelectedId} onPrev={() => step(-1)} onNext={() => step(1)} />
      </div>
    </div>
  );
}
