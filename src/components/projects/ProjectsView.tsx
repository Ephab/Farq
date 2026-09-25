"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, ExternalLink } from "lucide-react"
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap"
import {
  api,
  getCurrentStudentId,
  notifyRoadmapChanged,
  ROADMAP_CHANGED_EVENT,
  type EvidenceItem,
} from "@/lib/farq-api"
import { cn } from "@/lib/utils"

interface RoadmapResponse {
  version: number
  snapshot: { title: string; nodes: RoadmapNodeData[]; stages: RoadmapStage[] }
}

interface ProjectsViewProps {
  onNavigate: (tab: string) => void
}

function statusLabel(status: NodeStatus): string {
  if (status === "done") return "Done"
  if (status === "in-progress") return "In progress"
  return "Up next"
}

function nextAction(status: NodeStatus): { label: string; next: NodeStatus } {
  if (status === "in-progress") return { label: "Mark done", next: "done" }
  if (status === "done") return { label: "Revisit", next: "in-progress" }
  return { label: "Start", next: "in-progress" }
}

export function ProjectsView({ onNavigate }: ProjectsViewProps) {
  const studentId = getCurrentStudentId()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<RoadmapNodeData[]>([])
  const [stages, setStages] = useState<RoadmapStage[]>([])
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [roadmap, items] = await Promise.all([
        api<RoadmapResponse>(`/api/students/${studentId}/roadmap`),
        api<EvidenceItem[]>(`/api/students/${studentId}/evidence`).catch(() => [] as EvidenceItem[]),
      ])
      setNodes(roadmap.snapshot.nodes)
      setStages(roadmap.snapshot.stages)
      setEvidence(items)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load projects")
    } finally {
      setLoading(false)
    }
  }, [studentId])

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
        setError(reason instanceof Error ? reason.message : "Could not update that milestone")
      } finally {
        setSavingId(null)
      }
    },
    [studentId],
  )

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-8" aria-label="Loading Projects">
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (error && projectNodes.length === 0 && projectRecords.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center p-8">
        <div className="text-center">
          <p className="text-sm font-semibold">Projects could not load</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void load()
            }}
            className="mt-3 h-9 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Projects make progress visible.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          {projectNodes.length > 0
            ? `${projectNodes.length} project ${projectNodes.length === 1 ? "milestone" : "milestones"} in your roadmap · ${doneCount} done`
            : "No project milestones in your roadmap yet"}
          {projectRecords.length > 0
            ? ` · ${projectRecords.length} project ${projectRecords.length === 1 ? "record" : "records"} confirmed`
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
                    {statusLabel(status)}
                  </span>
                  <span className="text-xs text-muted-foreground">{node.duration}</span>
                </div>
                <h2 className="mt-3 text-xl font-semibold">{node.title}</h2>
                {node.tagline || node.description ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {node.tagline || node.description}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {stage ? stage.title : ""}
                  {node.nodeType === "opportunity" ? " · Opportunity" : " · Project"}
                </p>
                {node.rationale ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">Why: {node.rationale}</p>
                ) : null}
                {node.nodeType === "opportunity" && node.opportunity ? (
                  <div className="mt-2 text-[13px] text-muted-foreground">
                    {node.opportunity.source_date ? (
                      <p>Date shown by {node.opportunity.source === "hackathonat" ? "Hackathonat" : node.opportunity.source}: {node.opportunity.source_date}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {node.opportunity.detail_url ? (
                        <a
                          href={node.opportunity.detail_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Details <ExternalLink aria-hidden="true" className="size-3.5" />
                        </a>
                      ) : null}
                      {node.opportunity.registration_url ? (
                        <a
                          href={node.opportunity.registration_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Register <ExternalLink aria-hidden="true" className="size-3.5" />
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
                        {resource.label} <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  <button
                    type="button"
                    disabled={savingId === node.id}
                    onClick={() => void setNodeStatus(node.id, action.next)}
                    className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {savingId === node.id ? "Saving…" : action.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate("Roadmap")}
                    className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open in roadmap
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <section className="rounded-2xl border border-border p-6 shadow-sm" aria-label="No project milestones">
          <h2 className="text-xl font-semibold">No project milestones yet</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Project work appears here when your roadmap includes project milestones. Ask Hermes Coach to add
            one, or confirm project evidence in My data so future drafts include it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("Hermes Coach")}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ask Hermes Coach <ArrowRight aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("My data")}
              className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open My data
            </button>
          </div>
        </section>
      )}

      {projectRecords.length > 0 ? (
        <section aria-labelledby="projects-records" className="mt-5 rounded-2xl border border-border p-6 shadow-sm">
          <h2 id="projects-records" className="text-xl font-semibold">Project records</h2>
          <p className="text-[13px] text-muted-foreground">
            {projectRecords.length} confirmed from your sources
          </p>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {projectRecords.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{item.title}</strong>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.source_ref || "Confirmed evidence"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate("My data")}
                  className="shrink-0 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
