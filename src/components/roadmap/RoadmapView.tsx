"use client";

import { matchesSearch } from "@/lib/i18n/core";
import { useI18n } from "@/lib/i18n/context";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, RotateCcw, Wand2 } from "lucide-react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";
import { useRoadmapProgress } from "@/hooks/use-roadmap-progress";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { RoadmapHeader, type LevelFilter } from "@/components/roadmap/RoadmapHeader";
import { NodeDetailPanel } from "@/components/roadmap/NodeDetailPanel";
import { AskCoachButton, RoadmapActionsMenu } from "@/components/roadmap/RoadmapActionsMenu";
import { PendingChanges } from "@/components/roadmap/PendingChanges";
import { RoadmapHistory } from "@/components/roadmap/RoadmapHistory";
import { RoadmapDialog } from "@/components/roadmap/RoadmapDialog";
import type { RoadmapPreview, RoadmapProposalData, RoadmapSnapshotData, RoadmapVersionSummary } from "@/components/roadmap/roadmap-types";
import { api, getCurrentStudentId, notifyRoadmapChanged, ROADMAP_CHANGED_EVENT } from "@/lib/waypoint-api";

interface RoadmapResponse {
  version_id: string;
  version: number;
  reason: string;
  snapshot: RoadmapSnapshotData;
}

type DialogState = null | { kind: "generate" } | { kind: "remove" } | { kind: "restore"; version: RoadmapVersionSummary };

const message = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);

export function RoadmapView({ onOpenProject, onAskCoach }: { onOpenProject?: (projectId: string) => void; onAskCoach?: (draft: string) => void }) {
  const { t, fmt } = useI18n();
  // Empty until this student's roadmap arrives: never flash (or let anyone edit) the demo seed.
  const [nodes, setNodes] = useState<RoadmapNodeData[]>([]);
  const [stages, setStages] = useState<RoadmapSnapshotData["stages"]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const studentId = getCurrentStudentId();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelFilter>("All");
  const [proposals, setProposals] = useState<RoadmapProposalData[]>([]);
  const [versions, setVersions] = useState<RoadmapVersionSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [preview, setPreview] = useState<RoadmapPreview | null>(null);
  const [notDone, setNotDone] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);

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

  const loadProposals = useCallback(() => api<RoadmapProposalData[]>(`/api/students/${studentId}/roadmap/proposals`)
    .then((items) => { setProposals(items.filter((item) => item.status === "pending")); return items; })
    .catch(() => []), [studentId]);
  const loadVersions = useCallback(() => api<RoadmapVersionSummary[]>(`/api/students/${studentId}/roadmap/versions`)
    .then((items) => { setVersions(items); return items; }).catch(() => [] as RoadmapVersionSummary[]), [studentId]);

  const load = useCallback(async () => {
    try {
      const response = await api<RoadmapResponse>(`/api/students/${studentId}/roadmap`);
      setNodes(response.snapshot.nodes); setStages(response.snapshot.stages); setVersion(response.version); setVersionId(response.version_id);
      setReason(response.reason); setTitle(response.snapshot.title); setLoadError(null);
    } catch (failure) {
      setLoadError(message(failure, ""));
    } finally {
      setLoaded(true);
    }
    await Promise.all([loadProposals(), loadVersions()]);
  }, [studentId, loadProposals, loadVersions]);

  useEffect(() => {
    void load();
    // Accepting a proposal anywhere (Hermes Coach, onboarding) creates a new version.
    window.addEventListener(ROADMAP_CHANGED_EVENT, load);
    // The coach writes proposals while this page is open (or in another tab): keep the inline list fresh.
    const timer = window.setInterval(() => void loadProposals(), 15000);
    const onFocus = () => void loadProposals();
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener(ROADMAP_CHANGED_EVENT, load); window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [load, loadProposals]);

  // What the canvas draws: the active roadmap, or a read-only preview of a draft / older version.
  const shown = preview ? preview.snapshot : { title: title ?? "", nodes, stages };
  const shownStatuses = useMemo(() => {
    if (!preview) return statuses;
    return Object.fromEntries(preview.snapshot.nodes.map((node) => [node.id, preview.kind === "proposal" && notDone.has(node.id) ? "not-started" : (node.status ?? "not-started")])) as Record<string, NodeStatus>;
  }, [preview, statuses, notDone]);

  const dimmedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dimmed = new Set<string>();
    for (const node of shown.nodes) {
      if (level !== "All" && node.level !== level) { dimmed.add(node.id); continue; }
      if (q && !matchesSearch(`${node.title} ${node.tagline} ${node.description} ${node.subtopics.join(" ")}`, q)) dimmed.add(node.id);
    }
    return dimmed;
  }, [shown.nodes, query, level]);

  const nodeMap = useMemo(() => Object.fromEntries(shown.nodes.map((node) => [node.id, node])), [shown.nodes]);
  const currentNodeMap = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, { ...node, status: statuses[node.id] ?? node.status }])), [nodes, statuses]);
  const selectedNode = selectedId ? (nodeMap[selectedId] ?? null) : null;
  const selectedIndex = selectedNode ? shown.nodes.findIndex((node) => node.id === selectedNode.id) : -1;

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const step = (direction: 1 | -1) => {
    const next = selectedIndex + direction;
    if (next >= 0 && next < shown.nodes.length) setSelectedId(shown.nodes[next].id);
  };

  const hasRoadmap = nodes.length > 0;
  const pendingOps = proposals.filter((item) => item.kind === "ops");
  const pendingInitial = proposals.find((item) => item.kind === "initial" && item.base_version_id === versionId) ?? null;
  const lastRoadmapVersion = versions.find((item) => !item.active && item.nodes > 0) ?? null;

  const leavePreview = () => { setPreview(null); setNotDone(new Set()); setSelectedId(null); };

  const decide = async (proposal: RoadmapProposalData, action: "accept" | "reject", body?: unknown) => {
    setBusyProposalId(proposal.id); setProposalError(null);
    try {
      await api(`/api/roadmap-proposals/${proposal.id}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      leavePreview();
      notifyRoadmapChanged();
      await load();
    } catch (failure) {
      setProposalError(message(failure, t("roadmap.pending.failed")));
      await loadProposals();
    } finally {
      setBusyProposalId(null);
    }
  };

  const openProposalPreview = (proposal: RoadmapProposalData) => {
    if (!proposal.snapshot) return;
    setSelectedId(null); setNotDone(new Set()); setShowHistory(false);
    setPreview({ kind: "proposal", proposal, snapshot: proposal.snapshot });
  };

  const viewVersion = async (item: RoadmapVersionSummary) => {
    setActionError(null);
    try {
      const full = await api<RoadmapResponse & { active: boolean }>(`/api/students/${studentId}/roadmap/versions/${item.id}`);
      setSelectedId(null);
      setPreview({ kind: "version", versionId: full.version_id, version: full.version, reason: full.reason, active: full.active, snapshot: full.snapshot });
    } catch (failure) {
      setActionError(message(failure, t("roadmap.dialog.failed")));
    }
  };

  const closeDialog = () => { if (!busy) { setDialog(null); setActionError(null); } };

  const confirmRemove = async () => {
    setBusy(true); setActionError(null);
    try {
      await api(`/api/students/${studentId}/roadmap/archive`, { method: "POST" });
      setDialog(null); leavePreview(); notifyRoadmapChanged(); await load();
    } catch (failure) { setActionError(message(failure, t("roadmap.dialog.failed"))); } finally { setBusy(false); }
  };

  const confirmRestore = async (target: RoadmapVersionSummary) => {
    setBusy(true); setActionError(null);
    try {
      await api(`/api/students/${studentId}/roadmap/versions/${target.id}/restore`, { method: "POST" });
      setDialog(null); leavePreview(); setShowHistory(false); notifyRoadmapChanged(); await load();
    } catch (failure) { setActionError(message(failure, t("roadmap.dialog.failed"))); } finally { setBusy(false); }
  };

  /** Generating is a coach proposal like any other: the old roadmap moves to history, the new one
   *  waits for review, and nothing is active until the student accepts it. */
  const confirmGenerate = async () => {
    setBusy(true); setActionError(null);
    const previousId = hasRoadmap ? versionId : null;
    let archived = false;
    try {
      const readiness = await api<{ ready: boolean; blockers: string[] }>(`/api/students/${studentId}/onboarding/readiness`);
      if (!readiness.ready) throw new Error(readiness.blockers.join("; "));
      if (previousId) { await api(`/api/students/${studentId}/roadmap/archive`, { method: "POST" }); archived = true; }
      let created: RoadmapProposalData;
      try {
        created = await api<RoadmapProposalData>(`/api/students/${studentId}/onboarding/generate`, { method: "POST", body: "{}" });
      } catch (failure) {
        // Never leave the student with nothing because generation failed.
        if (archived && previousId) await api(`/api/students/${studentId}/roadmap/versions/${previousId}/restore`, { method: "POST" }).catch(() => undefined);
        throw failure;
      }
      setDialog(null); notifyRoadmapChanged();
      await load();
      openProposalPreview(created);
    } catch (failure) {
      setActionError(message(failure, t("roadmap.dialog.generateFailed")));
      if (archived) { notifyRoadmapChanged(); await load(); }
    } finally { setBusy(false); }
  };

  const askCoach = () => onAskCoach?.(t("roadmap.actions.askCoachDraft"));

  const actions = (
    <>
      {onAskCoach ? <AskCoachButton onClick={askCoach} /> : null}
      <RoadmapActionsMenu hasRoadmap={hasRoadmap} hasHistory={versions.length > 1} onGenerate={() => { setActionError(null); setDialog({ kind: "generate" }); }} onHistory={() => setShowHistory((value) => !value)} onReset={confirmReset} onRemove={() => { setActionError(null); setDialog({ kind: "remove" }); }} />
    </>
  );

  const showCanvas = loaded && shown.nodes.length > 0;
  const preDone = preview?.kind === "proposal" ? preview.snapshot.nodes.filter((node) => node.status === "done") : [];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-none flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 shrink-0 flex-col overflow-y-auto" style={{ maxHeight: "48%" }}>
        {preview ? (
          <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-64">
                <h1 dir="auto" className="truncate text-base font-semibold">{preview.snapshot.title}</h1>
                <p className="text-xs text-muted-foreground">
                  {preview.kind === "proposal" ? t("roadmap.preview.draftBanner") : t("roadmap.preview.versionBanner", { version: fmt.number(preview.version) })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={leavePreview} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />{t("roadmap.preview.back")}</button>
                {preview.kind === "proposal" ? (
                  <>
                    <button type="button" disabled={busyProposalId !== null} onClick={() => void decide(preview.proposal, "reject")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{t("roadmap.preview.discard")}</button>
                    <button type="button" disabled={busyProposalId !== null} onClick={() => void decide(preview.proposal, "accept", { not_done: [...notDone] })} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{busyProposalId ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}{t("roadmap.preview.useThis")}</button>
                  </>
                ) : !preview.active ? (
                  <button type="button" onClick={() => setDialog({ kind: "restore", version: { id: preview.versionId, version: preview.version, reason: preview.reason, active: false, created_at: "", title: preview.snapshot.title, nodes: preview.snapshot.nodes.length, done: 0 } })} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><RotateCcw className="size-3.5" aria-hidden="true" />{t("roadmap.history.restore")}</button>
                ) : null}
              </div>
            </div>
            {proposalError ? <p role="alert" className="mt-2 text-xs text-destructive">{proposalError}</p> : null}
            {preDone.length ? (
              <div className="mt-3">
                <p className="text-xs font-medium">{t("roadmap.preview.mastered")}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {preDone.map((node) => {
                    const kept = !notDone.has(node.id);
                    return (
                      <label key={node.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${kept ? "border-emerald-500/40 bg-emerald-500/10" : "border-border text-muted-foreground"}`}>
                        <input type="checkbox" checked={kept} onChange={(event) => setNotDone((current) => { const next = new Set(current); if (event.target.checked) next.delete(node.id); else next.add(node.id); return next; })} className="size-3.5" />
                        <bdi className={kept ? undefined : "line-through"}>{node.title}</bdi>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <RoadmapHeader title={title ?? t("roadmap.defaultTitle")} versionLine={version !== null && hasRoadmap ? (reason ? t("roadmap.versionLine", { version: fmt.number(version), reason }) : t("roadmap.personalVersion", { version: fmt.number(version) })) : null} done={summary.done} total={summary.total} percent={summary.percent} query={query} onQuery={setQuery} level={level} onLevel={setLevel} actions={actions} />
            {loadError !== null ? <div className="border-b border-amber-500/30 bg-amber-500/5 px-6 py-2 text-xs text-amber-700">{t("roadmap.backendUnavailable", { error: loadError || t("roadmap.loadError") })}</div> : null}
            {showHistory ? <RoadmapHistory versions={versions} onView={(item) => void viewVersion(item)} onRestore={(item) => { setActionError(null); setDialog({ kind: "restore", version: item }); }} onClose={() => setShowHistory(false)} /> : null}
            <PendingChanges proposals={pendingOps} currentVersionId={versionId} nodeMap={currentNodeMap} stages={stages} busyId={busyProposalId} error={proposalError} onAccept={(proposal) => void decide(proposal, "accept")} onReject={(proposal) => void decide(proposal, "reject")} onReview={openProposalPreview} onSelectNode={setSelectedId} />
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {!loaded ? (
          <div className="grid flex-1 place-items-center" role="status" aria-label={t("common.loading")}><LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
        ) : shown.nodes.length === 0 ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            {loadError !== null ? <p className="text-sm text-muted-foreground">{t("roadmap.loadError")}</p> : (
              <div className="max-w-sm">
                <h2 className="text-base font-semibold">{t("roadmap.emptyTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{pendingInitial ? t("roadmap.emptyDraftReady") : t("roadmap.empty")}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {pendingInitial ? <button type="button" onClick={() => openProposalPreview(pendingInitial)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("roadmap.pending.review")}</button> : (
                    <button type="button" onClick={() => { setActionError(null); setDialog({ kind: "generate" }); }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><Wand2 className="size-4" aria-hidden="true" />{t("roadmap.actions.generate")}</button>
                  )}
                  {lastRoadmapVersion ? <button type="button" onClick={() => setDialog({ kind: "restore", version: lastRoadmapVersion })} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><RotateCcw className="size-4" aria-hidden="true" />{t("roadmap.restorePrevious", { version: fmt.number(lastRoadmapVersion.version) })}</button> : null}
                </div>
              </div>
            )}
          </div>
        ) : null}
        {showCanvas ? <RoadmapCanvas
          title={shown.title || undefined}
          nodes={shown.nodes}
          stages={shown.stages}
          statuses={shownStatuses}
          selectedId={selectedId}
          dimmedIds={dimmedIds}
          onSelect={setSelectedId}
          onToggleDone={(id) => { if (!preview) setStatus(id, statuses[id] === "done" ? "not-started" : "done") }}
          onOpenProject={preview ? undefined : onOpenProject}
        /> : null}
        <NodeDetailPanel node={selectedNode} nodeMap={nodeMap} status={selectedId ? (shownStatuses[selectedId] ?? "not-started") : "not-started"} allowedStatuses={preview ? [] : undefined} hasPrev={selectedIndex > 0} hasNext={selectedIndex >= 0 && selectedIndex < shown.nodes.length - 1} onStatus={(status) => { if (!preview && selectedId) setStatus(selectedId, status) }} onClose={() => setSelectedId(null)} onNavigate={setSelectedId} onPrev={() => step(-1)} onNext={() => step(1)} />
      </div>

      {dialog?.kind === "generate" ? (
        <RoadmapDialog title={t("roadmap.dialog.generateTitle")} confirmLabel={busy ? t("roadmap.dialog.generating") : t("roadmap.dialog.generateConfirm")} busy={busy} error={actionError} onConfirm={() => void confirmGenerate()} onCancel={closeDialog}>
          {hasRoadmap ? <p>{t("roadmap.dialog.generateReplaces")}</p> : null}
          <p>{t("roadmap.dialog.generateHow")}</p>
          {busy ? <p className="text-foreground">{t("roadmap.dialog.generateWait")}</p> : null}
        </RoadmapDialog>
      ) : null}
      {dialog?.kind === "remove" ? (
        <RoadmapDialog title={t("roadmap.dialog.removeTitle")} confirmLabel={t("roadmap.dialog.removeConfirm")} danger busy={busy} error={actionError} onConfirm={() => void confirmRemove()} onCancel={closeDialog}>
          <p>{t("roadmap.dialog.removeBody", { done: fmt.number(summary.done), total: fmt.number(summary.total) })}</p>
          <p>{t("roadmap.dialog.removeKept")}</p>
        </RoadmapDialog>
      ) : null}
      {dialog?.kind === "restore" ? (
        <RoadmapDialog title={t("roadmap.dialog.restoreTitle", { version: fmt.number(dialog.version.version) })} confirmLabel={t("roadmap.history.restore")} busy={busy} error={actionError} onConfirm={() => void confirmRestore(dialog.version)} onCancel={closeDialog}>
          <p>{hasRoadmap ? t("roadmap.dialog.restoreReplaces") : t("roadmap.dialog.restoreBody")}</p>
        </RoadmapDialog>
      ) : null}
    </div>
  );
}
