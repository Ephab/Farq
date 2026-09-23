"use client";

import { useEffect, useMemo, useState } from "react";
import { NODES, NODE_MAP } from "@/data/computer-vision-roadmap";
import { useRoadmapProgress } from "@/hooks/use-roadmap-progress";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { RoadmapHeader, type LevelFilter } from "@/components/roadmap/RoadmapHeader";
import { NodeDetailPanel } from "@/components/roadmap/NodeDetailPanel";

export function RoadmapView() {
  const { statuses, setStatus, reset, summary } = useRoadmapProgress();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelFilter>("All");

  const dimmedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dimmed = new Set<string>();
    for (const node of NODES) {
      if (level !== "All" && node.level !== level) {
        dimmed.add(node.id);
        continue;
      }
      if (q) {
        const hay = `${node.title} ${node.tagline} ${node.description} ${node.subtopics.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) dimmed.add(node.id);
      }
    }
    return dimmed;
  }, [query, level]);

  const selectedNode = selectedId ? (NODE_MAP[selectedId] ?? null) : null;
  const selectedIndex = selectedNode
    ? NODES.findIndex((n) => n.id === selectedNode.id)
    : -1;

  // Close the panel with Escape.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const step = (dir: 1 | -1) => {
    const next = selectedIndex + dir;
    if (next >= 0 && next < NODES.length) setSelectedId(NODES[next].id);
  };

  return (
    <div className="flex min-h-[calc(100svh-4rem)] flex-1 flex-col bg-background">
      <RoadmapHeader
        done={summary.done}
        total={summary.total}
        percent={summary.percent}
        query={query}
        onQuery={setQuery}
        level={level}
        onLevel={setLevel}
        onReset={reset}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <RoadmapCanvas
          statuses={statuses}
          selectedId={selectedId}
          dimmedIds={dimmedIds}
          onSelect={setSelectedId}
        />
        <NodeDetailPanel
          node={selectedNode}
          status={selectedId ? (statuses[selectedId] ?? "not-started") : "not-started"}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex >= 0 && selectedIndex < NODES.length - 1}
          onStatus={(s) => selectedId && setStatus(selectedId, s)}
          onClose={() => setSelectedId(null)}
          onNavigate={setSelectedId}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      </div>
    </div>
  );
}
