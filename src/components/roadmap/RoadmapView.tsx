"use client";

import { matchesSearch } from "@/lib/i18n/core";
import { useI18n } from "@/lib/i18n/context";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";
import type { RoadmapOrientation } from "@/lib/roadmap-layout";
import { useRoadmapProgress } from "@/hooks/use-roadmap-progress";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { RoadmapHeader, type LevelFilter } from "@/components/roadmap/RoadmapHeader";
import { NodeDetailPanel } from "@/components/roadmap/NodeDetailPanel";
import { api, getCurrentStudentId, ROADMAP_CHANGED_EVENT } from "@/lib/waypoint-api";

interface RoadmapResponse {
  version: number;
  snapshot: { title: string; nodes: RoadmapNodeData[]; stages: RoadmapStage[] };
}

export function RoadmapView({ onOpenProject }: { onOpenProject?: (projectId: string) => void }) {
  const { t, fmt } = useI18n();
  // Empty until this student's roadmap arrives: never flash (or let anyone edit) the demo seed.
  const [nodes, setNodes] = useState<RoadmapNodeData[]>([]);
  const [stages, setStages] = useState<RoadmapStage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const studentId = getCurrentStudentId();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelFilter>("All");
  const [view, setView] = useState<RoadmapOrientation>("vertical");

  const initialStatuses = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node.status ?? "not-started"])) as Record<string, NodeStatus>, [nodes]);
  const persist = useCallback(async (id: string, status: NodeStatus) => {
    await api(`/api/students/${studentId}/roadmap/nodes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status }) });
  }, [studentId]);
  const persistMany = useCallback(async (next: Record<string, NodeStatus>) => {
    await api(`/api/students/${studentId}/roadmap/progress`, { method: "PUT", body: JSON.stringify({ statuses: next }) });
  }, [studentId]);
  const { statuses, setStatus, reset, summary } = useRoadmapProgress(nodes, initialStatuses, persist, persistMany);
  const confirmReset = useCallback(() => {
    // Wipes every node's progress on the server: ask first.
    if (window.confirm(t("roadmap.header.resetConfirm"))) reset();
  }, [reset, t]);

  useEffect(() => {
    const load = () => api<RoadmapResponse>(`/api/students/${studentId}/roadmap`).then((response) => {
      setNodes(response.snapshot.nodes); setStages(response.snapshot.stages); setVersion(response.version); setTitle(response.snapshot.title); setLoadError(null);
    }).catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : "")).finally(() => setLoaded(true));
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
      if (q && !matchesSearch(`${node.title} ${node.tagline} ${node.description} ${node.subtopics.join(" ")}`, q)) dimmed.add(node.id);
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
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-none flex-col overflow-hidden bg-background">
      <RoadmapHeader title={title ?? t("roadmap.defaultTitle")} done={summary.done} total={summary.total} percent={summary.percent} query={query} onQuery={setQuery} level={level} onLevel={setLevel} view={view} onView={setView} onReset={confirmReset} />
      {version ? <div className="border-b border-border px-6 py-1.5 text-end text-[11px] text-muted-foreground">{t("roadmap.personalVersion", { version: fmt.number(version) })}</div> : null}
      {loadError !== null ? <div className="border-b border-amber-500/30 bg-amber-500/5 px-6 py-2 text-xs text-amber-700">{t("roadmap.backendUnavailable", { error: loadError || t("roadmap.loadError") })}</div> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!loaded ? (
          <div className="grid flex-1 place-items-center" role="status" aria-label={t("common.loading")}><LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
        ) : nodes.length === 0 ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{loadError !== null ? t("roadmap.loadError") : t("roadmap.empty")}</div>
        ) : null}
        {loaded && nodes.length > 0 ? <RoadmapCanvas
          nodes={nodes}
          stages={stages}
          statuses={statuses}
          selectedId={selectedId}
          dimmedIds={dimmedIds}
          orientation={view}
          onSelect={setSelectedId}
          onToggleDone={(id) => setStatus(id, statuses[id] === "done" ? "not-started" : "done")}
          onOpenProject={onOpenProject}
        /> : null}
        <NodeDetailPanel node={selectedNode} nodeMap={nodeMap} status={selectedId ? (statuses[selectedId] ?? "not-started") : "not-started"} hasPrev={selectedIndex > 0} hasNext={selectedIndex >= 0 && selectedIndex < nodes.length - 1} onStatus={(status) => selectedId && setStatus(selectedId, status)} onClose={() => setSelectedId(null)} onNavigate={setSelectedId} onPrev={() => step(-1)} onNext={() => step(1)} />
      </div>
    </div>
  );
}
