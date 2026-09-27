"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, ExternalLink } from "lucide-react"
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace"
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap"
import {
  api,
  getCurrentStudentId,
  notifyRoadmapChanged,
  ROADMAP_CHANGED_EVENT,
  type EvidenceItem,
  type WaypointProject,
} from "@/lib/waypoint-api"
import { cn } from "@/lib/utils"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

interface RoadmapResponse {
  version: number
  snapshot: { title: string; nodes: RoadmapNodeData[]; stages: RoadmapStage[] }
}

interface ProjectsViewProps {
  onNavigate: (tab: string) => void
  selectedProjectId?: string | null
  onSelectProject?: (projectId: string | null) => void
  onAskHermes?: (prompt: string) => void
}

function statusLabel(status: NodeStatus): MessageKey {
  if (status === "done") return "dashboard.projects.status.done"
  if (status === "in-progress") return "dashboard.projects.status.inProgress"
  return "dashboard.projects.status.upNext"
}

function nextAction(status: NodeStatus): { label: MessageKey; next: NodeStatus } {
  if (status === "in-progress") return { label: "dashboard.projects.action.markDone", next: "done" }
  if (status === "done") return { label: "dashboard.projects.action.revisit", next: "in-progress" }
  return { label: "dashboard.projects.action.start", next: "in-progress" }
}

export function ProjectsView({ onNavigate, selectedProjectId = null, onSelectProject = () => undefined, onAskHermes = () => undefined }: ProjectsViewProps) {
  const studentId = getCurrentStudentId()
  const { t, fmt } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<RoadmapNodeData[]>([])
  const [stages, setStages] = useState<RoadmapStage[]>([])
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [projects, setProjects] = useState<WaypointProject[]>([])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [roadmap, items, projectItems] = await Promise.all([
        api<RoadmapResponse>(`/api/students/${studentId}/roadmap`),
        api<EvidenceItem[]>(`/api/students/${studentId}/evidence`).catch(() => [] as EvidenceItem[]),
        api<WaypointProject[]>(`/api/students/${studentId}/projects`).catch(() => [] as WaypointProject[]),
      ])
      setNodes(roadmap.snapshot.nodes)
      setStages(roadmap.snapshot.stages)
      setEvidence(items)
      setProjects(projectItems)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("dashboard.projects.loadError"))
    } finally {
      setLoading(false)
    }
  }, [studentId, t])

  useEffect(() => {
    void load()
    window.addEventListener(ROADMAP_CHANGED_EVENT, load)
    return () => window.removeEventListener(ROADMAP_CHANGED_EVENT, load)
  }, [load])

  const projectNodes = useMemo(
    () => nodes.filter((node) => node.nodeType === "project" || node.nodeType === "opportunity"),
    [nodes],
  )

  const projectRecords = useMemo(
    () => evidence.filter((item) => item.kind === "project" && item.status === "confirmed"),
    [evidence],
  )

  const doneCount = useMemo(
    () => projectNodes.filter((node) => (node.status ?? "not-started") === "done").length,
    [projectNodes],
  )

  const stageOf = useCallback(
    (node: RoadmapNodeData) => stages.find((stage) => stage.nodeIds.includes(node.id)),
    [stages],
  )
  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null

  const setNodeStatus = useCallback(
    async (id: string, status: NodeStatus) => {
      setSavingId(id)
      try {
        await api(`/api/students/${studentId}/roadmap/nodes/${id}`, {
          method: "PUT",
          body: JSON.stringify({ status }),
        })
        setNodes((previous) => previous.map((node) => (node.id === id ? { ...node, status } : node)))
        notifyRoadmapChanged()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("dashboard.projects.updateError"))
      } finally {
        setSavingId(null)
      }
    },
    [studentId, t],
  )

  if (selectedProject) {
    return <ProjectWorkspace project={selectedProject} onBack={() => onSelectProject(null)} onRefresh={() => void load()} onAskHermes={(prompt) => { onAskHermes(prompt); onNavigate("Hermes Coach") }} />
  }

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-8" aria-label={t("dashboard.projects.loadingLabel")}>
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (error && projectNodes.length === 0 && projectRecords.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center p-8">
        <div className="text-center">
          <p className="text-sm font-semibold">{t("dashboard.projects.couldNotLoad")}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void load()
            }}
            className="mt-3 h-9 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("dashboard.projects.tryAgain")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("dashboard.projects.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          {projectNodes.length > 0
            ? t("dashboard.projects.milestones", { count: projectNodes.length, done: doneCount })
            : t("dashboard.projects.noMilestonesYetLine")}
          {projectRecords.length > 0
            ? t("dashboard.projects.recordsConfirmed", { count: projectRecords.length })
            : ""}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}

      {projectNodes.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {projectNodes.map((node) => {
            const status = (node.status ?? "not-started") as NodeStatus
            const action = nextAction(status)
            const stage = stageOf(node)
            const project = node.projectId ? projects.find((item) => item.id === node.projectId) : projects.find((item) => item.roadmap_node_id === node.id)
            return (
              <article key={node.id} className="flex flex-col rounded-2xl border border-border p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold",
                      status === "done" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      status === "in-progress" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                      status === "not-started" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {t(statusLabel(status))}
                  </span>
                  <bdi className="text-xs text-muted-foreground">{node.duration}</bdi>
                </div>
                {project?.latest_score !== null && project?.latest_score !== undefined ? <p className="mt-3 text-3xl font-semibold tabular-nums">{fmt.percent(project.latest_score / 100)} <span className="text-xs font-medium text-muted-foreground">{t("dashboard.projects.latestEvaluation")}</span></p> : null}
                <h2 dir="auto" className="mt-3 text-start text-xl font-semibold">{node.title}</h2>
                {node.tagline || node.description ? (
                  <p dir="auto" className="mt-1.5 text-start text-sm text-muted-foreground">
                    {node.tagline || node.description}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {stage ? <bdi>{stage.title}</bdi> : ""}
                  {node.nodeType === "opportunity" ? t("dashboard.projects.kind.opportunity") : t("dashboard.projects.kind.project")}
                </p>
                {node.rationale ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {t("dashboard.projects.why", { reason: "\u2068" + node.rationale + "\u2069" })}
                  </p>
                ) : null}
                {node.nodeType === "opportunity" && node.opportunity ? (
                  <div className="mt-2 text-[13px] text-muted-foreground">
                    {node.opportunity.source_date ? (
                      <p>
                        {t("dashboard.projects.dateShownBy", {
                          source: "\u2068" + (node.opportunity.source === "hackathonat" ? "Hackathonat" : node.opportunity.source) + "\u2069",
                          date: "\u2068" + node.opportunity.source_date + "\u2069",
                        })}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {node.opportunity.detail_url ? (
                        <a
                          href={node.opportunity.detail_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t("dashboard.projects.details")} <ExternalLink aria-hidden="true" className="size-3.5" />
                        </a>
                      ) : null}
                      {node.opportunity.registration_url ? (
                        <a
                          href={node.opportunity.registration_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t("dashboard.projects.register")} <ExternalLink aria-hidden="true" className="size-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {node.resources.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {node.resources.map((resource) => (
                      <a
                        key={resource.url}
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <bdi>{resource.label}</bdi> <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  {node.nodeType === "project" && project ? <button type="button" onClick={() => onSelectProject(project.id)} className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("dashboard.projects.openWorkspace")}</button> : null}
                  <button
                    type="button"
                    disabled={savingId === node.id}
                    onClick={() => void setNodeStatus(node.id, action.next)}
                    className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {savingId === node.id ? t("dashboard.projects.saving") : t(action.label)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate("Roadmap")}
                    className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("dashboard.projects.openInRoadmap")}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <section className="rounded-2xl border border-border p-6 shadow-sm" aria-label={t("dashboard.projects.empty.label")}>
          <h2 className="text-xl font-semibold">{t("dashboard.projects.empty.title")}</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{t("dashboard.projects.empty.body")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("Hermes Coach")}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("dashboard.projects.empty.askCoach")} <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("My data")}
              className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("dashboard.projects.empty.openMyData")}
            </button>
          </div>
        </section>
      )}

      {projectRecords.length > 0 ? (
        <section aria-labelledby="projects-records" className="mt-5 rounded-2xl border border-border p-6 shadow-sm">
          <h2 id="projects-records" className="text-xl font-semibold">{t("dashboard.projects.records.title")}</h2>
          <p className="text-[13px] text-muted-foreground">
            {t("dashboard.projects.records.confirmed", { count: projectRecords.length })}
          </p>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {projectRecords.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <bdi className="block truncate text-start text-sm font-bold">{item.title}</bdi>
                  <span dir={item.source_ref ? "auto" : undefined} className="block truncate text-start text-xs text-muted-foreground">
                    {item.source_ref || t("dashboard.projects.records.fallback")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate("My data")}
                  className="shrink-0 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("dashboard.projects.records.view")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
