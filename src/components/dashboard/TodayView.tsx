"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  ExternalLink,
  ListChecks,
  Lock,
  Route,
} from "lucide-react"
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap"
import {
  api,
  getCurrentStudentId,
  notifyRoadmapChanged,
  ROADMAP_CHANGED_EVENT,
  type DataSourceItem,
  type EvidenceItem,
  type StudentProfile,
} from "@/lib/farq-api"
import { loadLibrary, type QuizLibrary } from "@/lib/quiz-store"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

interface RoadmapResponse {
  version: number
  reason?: string
  snapshot: { title: string; nodes: RoadmapNodeData[]; stages: RoadmapStage[] }
}

interface ProposalSummary {
  id: string
  summary: string
  reasoning: string
  kind: string
  status: string
  created_at: string
}

interface StudentFact {
  id: string
  category: string
  key: string
  value: unknown
  confidence: number
}

interface ContextResponse {
  id: string
  display_name: string
  facts: StudentFact[]
}

interface TodayViewProps {
  onNavigate: (tab: string) => void
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  transcript_pdf: "Transcript",
  cv_pdf: "CV",
  linkedin_pdf: "LinkedIn PDF",
  linkedin_zip: "LinkedIn export",
  github: "GitHub",
  folder: "Project folder",
  portfolio_url: "Portfolio",
  orcid: "ORCID",
}

function prettyKind(kind: string): string {
  return SOURCE_KIND_LABEL[kind] ?? kind.replace(/_/g, " ")
}

function capitalize(kind: string): string {
  return kind.length > 0 ? kind[0].toUpperCase() + kind.slice(1) : kind
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

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function factText(value: unknown): string {
  if (typeof value === "string") return value
  if (value == null) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

function emptyLibrary(): QuizLibrary {
  return { decks: [], quizzes: [], extensions: [] }
}

export function TodayView({ onNavigate }: TodayViewProps) {
  const studentId = getCurrentStudentId()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [version, setVersion] = useState<number | null>(null)
  const [nodes, setNodes] = useState<RoadmapNodeData[]>([])
  const [stages, setStages] = useState<RoadmapStage[]>([])
  const [displayName, setDisplayName] = useState("")
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [sources, setSources] = useState<DataSourceItem[]>([])
  const [facts, setFacts] = useState<StudentFact[]>([])
  const [practice, setPractice] = useState<QuizLibrary>(() => {
    try {
      return loadLibrary()
    } catch {
      return emptyLibrary()
    }
  })
  const [savingId, setSavingId] = useState<string | null>(null)
  const reduce = useReducedMotion()

  const load = useCallback(async () => {
    setError(null)
    try {
      const [roadmap, profile, items, pending, sourceItems, context] = await Promise.all([
        api<RoadmapResponse>(`/api/students/${studentId}/roadmap`),
        api<StudentProfile>(`/api/students/${studentId}/profile`).catch(() => null),
        api<EvidenceItem[]>(`/api/students/${studentId}/evidence`).catch(() => [] as EvidenceItem[]),
        api<ProposalSummary[]>(`/api/students/${studentId}/roadmap/proposals`).catch(
          () => [] as ProposalSummary[],
        ),
        api<DataSourceItem[]>(`/api/students/${studentId}/sources`).catch(() => [] as DataSourceItem[]),
        api<ContextResponse>(`/api/students/${studentId}/context`).catch(() => null),
      ])
      setTitle(roadmap.snapshot.title || "Roadmap")
      setVersion(roadmap.version)
      setNodes(roadmap.snapshot.nodes)
      setStages(roadmap.snapshot.stages)
      if (profile) setDisplayName(profile.display_name)
      setEvidence(items)
      setProposals(pending)
      setSources(sourceItems.filter((item) => item.status !== "removed"))
      if (context) {
        setFacts(context.facts)
        if (!profile && context.display_name) setDisplayName(context.display_name)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your dashboard")
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    void load()
    window.addEventListener(ROADMAP_CHANGED_EVENT, load)
    return () => window.removeEventListener(ROADMAP_CHANGED_EVENT, load)
  }, [load])

  useEffect(() => {
    const refreshPractice = () => {
      try {
        setPractice(loadLibrary())
      } catch {
        // Keep the previously loaded library.
      }
    }
    window.addEventListener("focus", refreshPractice)
    return () => window.removeEventListener("focus", refreshPractice)
  }, [])

  const nodeMap = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node])), [nodes])

  const doneSet = useMemo(() => {
    const done = new Set<string>()
    for (const node of nodes) {
      if ((node.status ?? "not-started") === "done") done.add(node.id)
    }
    return done
  }, [nodes])

  const readiness = useMemo(() => {
    const readinessById = new Map<string, { ready: boolean; waitingOn: string[] }>()
    for (const node of nodes) {
      const waitingOn = (node.deps ?? []).filter((dep) => !doneSet.has(dep))
      readinessById.set(node.id, { ready: waitingOn.length === 0, waitingOn })
    }
    return readinessById
  }, [nodes, doneSet])

  const currentNode = useMemo<RoadmapNodeData | null>(() => {
    if (nodes.length === 0) return null
    const inProgress = nodes.find((node) => (node.status ?? "not-started") === "in-progress")
    if (inProgress) return inProgress
    const ready = nodes.find(
      (node) =>
        (node.status ?? "not-started") === "not-started" &&
        (node.deps ?? []).every((dep) => doneSet.has(dep)),
    )
    if (ready) return ready
    return nodes.find((node) => (node.status ?? "not-started") !== "done") ?? nodes[0]
  }, [nodes, doneSet])

  const currentStage = useMemo<RoadmapStage | null>(() => {
    if (!currentNode) return null
    return stages.find((stage) => stage.nodeIds.includes(currentNode.id)) ?? stages[0] ?? null
  }, [currentNode, stages])

  const summary = useMemo(() => {
    let done = 0
    let inProgress = 0
    for (const node of nodes) {
      const status = node.status ?? "not-started"
      if (status === "done") done += 1
      else if (status === "in-progress") inProgress += 1
    }
    const total = nodes.length
    return {
      done,
      inProgress,
      remaining: total - done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
    }
  }, [nodes])

  const stageNodes = useMemo(() => {
    if (!currentStage) return []
    return currentStage.nodeIds
      .map((id) => nodeMap[id])
      .filter((node): node is RoadmapNodeData => Boolean(node))
  }, [currentStage, nodeMap])

  const stageSummary = useMemo(() => {
    const done = stageNodes.filter((node) => (node.status ?? "not-started") === "done").length
    return {
      done,
      total: stageNodes.length,
      percent: stageNodes.length ? Math.round((done / stageNodes.length) * 100) : 0,
    }
  }, [stageNodes])

  const upNext = useMemo(() => {
    if (!currentNode) return []
    const seen = new Set<string>([currentNode.id])
    const rest = nodes.filter((node) => {
      if (seen.has(node.id) || (node.status ?? "not-started") === "done") return false
      seen.add(node.id)
      return true
    })
    return [currentNode, ...rest].slice(0, 5)
  }, [nodes, currentNode])

  const confirmedEvidence = useMemo(() => evidence.filter((item) => item.status === "confirmed"), [evidence])
  const suggestedEvidence = useMemo(() => evidence.filter((item) => item.status === "suggested"), [evidence])

  const confirmedByKind = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of confirmedEvidence) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [confirmedEvidence])

  const pendingProposals = useMemo(
    () =>
      proposals
        .filter((item) => item.status === "pending")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [proposals],
  )

  const visibleFacts = useMemo(
    () => facts.filter((fact) => factText(fact.value).trim().length > 0).slice(0, 8),
    [facts],
  )

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    [],
  )

  const subtitle = useMemo(() => {
    if (nodes.length === 0) return ""
    if (summary.done === summary.total) {
      return `${displayName ? `${displayName} — ` : ""}all ${summary.total} topics done. Ask Hermes Coach to plan what's next.`
    }
    if (currentStage) {
      return `Working through ${currentStage.title} — ${summary.done} of ${summary.total} topics done.`
    }
    return `${summary.done} of ${summary.total} topics done.`
  }, [nodes.length, summary, currentStage, displayName])

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
        setError(reason instanceof Error ? reason.message : "Could not update that topic")
      } finally {
        setSavingId(null)
      }
    },
    [studentId],
  )

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-8" aria-label="Loading Today">
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="h-96 animate-pulse rounded-3xl bg-muted" />
          <div className="h-96 animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    )
  }

  if (error && nodes.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center p-8">
        <div className="text-center">
          <p className="text-sm font-semibold">Today could not load</p>
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

  if (nodes.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center p-8">
        <div className="text-center">
          <p className="text-sm font-semibold">No roadmap yet{displayName ? `, ${displayName}` : ""}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your Today view appears once your first roadmap is generated.
          </p>
          <button
            type="button"
            onClick={() => onNavigate("Roadmap")}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open Roadmap <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  const currentStatus = (currentNode?.status ?? "not-started") as NodeStatus
  const currentAction = nextAction(currentStatus)
  const heroDetail = currentNode?.tagline || currentNode?.description || currentStage?.description || ""

  const stats = [
    { label: "Done", value: `${summary.done}/${summary.total}`, tab: "Roadmap" },
    { label: "In progress", value: `${summary.inProgress}`, tab: "Roadmap" },
    { label: "Remaining", value: `${summary.remaining}`, tab: "Roadmap" },
    { label: "Records confirmed", value: `${confirmedEvidence.length}`, tab: "My data" },
    { label: "Awaiting review", value: `${suggestedEvidence.length}`, tab: "My data" },
    { label: "Coach drafts", value: `${pendingProposals.length}`, tab: "Hermes Coach" },
  ]

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="mx-auto w-full max-w-6xl p-4 sm:p-8"
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="mb-5 flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{todayLabel}</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">One useful step today.</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{subtitle}</p>
        </div>
        <motion.button
          type="button"
          onClick={() => onNavigate("Roadmap")}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Route aria-hidden="true" className="size-4" /> Open roadmap
        </motion.button>
      </motion.div>

      {visibleFacts.length > 0 ? (
        <div className="mb-5 flex flex-wrap gap-2" aria-label="What Hermes knows about you">
          {visibleFacts.map((fact) => (
            <span
              key={fact.id}
              title={`${fact.category} · ${fact.key}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"
            >
              <span className="font-semibold text-foreground">{capitalize(fact.category)}</span>
              <span className="truncate">{factText(fact.value)}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="list" aria-label="Today at a glance">
        {stats.map((stat, index) => (
          <motion.button
            key={stat.label}
            type="button"
            role="listitem"
            onClick={() => onNavigate(stat.tab)}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.25), ease: EASE_OUT }}
            className="rounded-2xl border border-border p-3 text-left shadow-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block text-xl font-semibold tabular-nums">{stat.value}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{stat.label}</span>
          </motion.button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <motion.section
          aria-labelledby="today-next"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="relative overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg sm:p-10"
        >
          <span className="inline-flex min-h-7 items-center rounded-full bg-primary-foreground/15 px-3 text-xs font-semibold">
            {statusLabel(currentStatus)} · {currentNode?.duration ?? ""}
          </span>
          <h2 id="today-next" className="mt-8 max-w-md text-3xl font-semibold leading-tight tracking-tight sm:mt-10 sm:text-5xl">
            {currentNode?.title}
          </h2>
          {heroDetail ? (
            <p className="mt-3 max-w-xl text-sm opacity-80 sm:text-base">{heroDetail}</p>
          ) : null}
          {currentNode && currentNode.subtopics.length > 0 ? (
            <ul className="mt-5 grid max-w-xl list-disc gap-1.5 pl-5 text-sm opacity-90" aria-label="Topics inside this step">
              {currentNode.subtopics.map((subtopic) => (
                <li key={subtopic}>{subtopic}</li>
              ))}
            </ul>
          ) : null}
          {currentNode && currentNode.resources.length > 0 ? (
            <div className="mt-5 flex max-w-xl flex-wrap gap-2" aria-label="Resources for this step">
              {currentNode.resources.map((resource) => (
                <a
                  key={resource.url}
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary-foreground/30 px-3.5 text-[13px] font-semibold outline-none hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {resource.label} <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              ))}
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate("Roadmap")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary-foreground px-5 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Continue topic <ArrowRight aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("Hermes Coach")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Bot aria-hidden="true" className="size-4" /> Ask Hermes
            </button>
            {currentNode && currentStatus !== "done" ? (
              <button
                type="button"
                disabled={savingId === currentNode.id}
                onClick={() => void setNodeStatus(currentNode.id, currentAction.next)}
                className="inline-flex min-h-11 items-center rounded-full border border-primary-foreground/30 px-4 text-sm font-semibold outline-none hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {savingId === currentNode.id ? "Saving…" : currentAction.label}
              </button>
            ) : null}
          </div>
        </motion.section>

        <motion.section
          aria-labelledby="today-up-next"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
          className="rounded-2xl border border-border p-6 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between text-[13px] text-muted-foreground">
            <span id="today-up-next">Up next · plan order</span>
            <span>
              Next {upNext.length} of {summary.remaining} remaining
            </span>
          </div>
          <ul className="divide-y divide-border">
            {upNext.map((node, index) => {
              const status = (node.status ?? "not-started") as NodeStatus
              const ready = readiness.get(node.id)
              const blocked = status === "not-started" && ready && !ready.ready
              const stage = stages.find((item) => item.nodeIds.includes(node.id))
              const actionable = index > 0 && status === "not-started" && ready?.ready
              return (
                <li key={node.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-sm font-bold text-primary">
                    {index === 0 ? "→" : index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate("Roadmap")}
                    className="min-w-0 flex-1 rounded-xl py-1 text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <strong className="block truncate text-sm">{node.title}</strong>
                    <span className="block truncate text-xs text-muted-foreground">
                      {stage ? `${stage.title} · ` : ""}
                      {node.duration}
                    </span>
                    {blocked ? (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock aria-hidden="true" className="size-3" />
                        Waiting on {ready.waitingOn.map((dep) => nodeMap[dep]?.title ?? dep).join(", ")}
                      </span>
                    ) : null}
                  </button>
                  {actionable ? (
                    <button
                      type="button"
                      disabled={savingId === node.id}
                      onClick={() => void setNodeStatus(node.id, "in-progress")}
                      className="h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {savingId === node.id ? "…" : "Start"}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex min-h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold",
                        status === "done" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        status === "in-progress" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                        status === "not-started" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {statusLabel(status)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </motion.section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <motion.section
          aria-labelledby="today-stage"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
          className="rounded-2xl border border-border p-6 shadow-sm"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id="today-stage" className="text-xl font-semibold">{currentStage ? currentStage.title : title}</h2>
              <p className="text-[13px] text-muted-foreground">
                {title}
                {version ? ` · version ${version}` : ""} · {stageSummary.done}/{stageSummary.total} done in this stage
              </p>
            </div>
            <span className="inline-flex min-h-7 items-center rounded-full bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {summary.done}/{summary.total} · {summary.percent}%
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={summary.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Overall roadmap progress"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${summary.percent}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[13px] text-muted-foreground">
            <span>This stage</span>
            <span>{stageSummary.percent}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${stageSummary.percent}%` }} />
          </div>
          <ul className="mt-3 divide-y divide-border">
            {stageNodes.map((node) => {
              const status = (node.status ?? "not-started") as NodeStatus
              const action = nextAction(status)
              return (
                <li key={node.id} className="flex items-center gap-3 py-2.5">
                  {status === "done" ? (
                    <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <span
                      className={cn(
                        "size-5 shrink-0 rounded-full border-2",
                        status === "in-progress" ? "border-amber-500" : "border-border",
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigate("Roadmap")}
                    className="min-w-0 flex-1 rounded-lg py-1 text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <strong className="block truncate text-sm">{node.title}</strong>
                    <span className="block truncate text-xs text-muted-foreground">{node.duration}</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingId === node.id}
                    onClick={() => void setNodeStatus(node.id, action.next)}
                    className="h-8 shrink-0 rounded-lg border border-border px-3 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {savingId === node.id ? "…" : action.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </motion.section>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15, ease: EASE_OUT }}
          className="grid content-start gap-5"
        >
          <section aria-labelledby="today-records" className="rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="today-records" className="text-xl font-semibold">Records</h2>
                <p className="text-[13px] text-muted-foreground">
                  {confirmedEvidence.length} confirmed
                  {suggestedEvidence.length > 0 ? ` · ${suggestedEvidence.length} awaiting review` : ""}
                </p>
              </div>
              <Database aria-hidden="true" className="size-5 text-muted-foreground" />
            </div>
            {confirmedByKind.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Confirmed records by kind">
                {confirmedByKind.map(([kind, count]) => (
                  <span
                    key={kind}
                    className="inline-flex min-h-7 items-center rounded-full bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                  >
                    {count} {capitalize(kind)}
                    {count === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
            ) : null}
            {suggestedEvidence.length > 0 ? (
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {suggestedEvidence.slice(0, 4).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">{item.title}</strong>
                      <span className="block text-xs text-muted-foreground">{capitalize(item.kind)} · suggested</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] text-muted-foreground">
                {confirmedEvidence.length > 0
                  ? "Everything suggested has been reviewed."
                  : "No records yet — add a source to give Hermes something to work with."}
              </p>
            )}
            <button
              type="button"
              onClick={() => onNavigate("My data")}
              className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {suggestedEvidence.length > 0 ? `Review ${suggestedEvidence.length} suggestions` : "Open My data"}{" "}
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </section>

          <section aria-labelledby="today-drafts" className="rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="today-drafts" className="text-xl font-semibold">Coach drafts</h2>
                <p className="text-[13px] text-muted-foreground">
                  {pendingProposals.length > 0
                    ? `${pendingProposals.length} waiting — nothing changes until you accept`
                    : "Nothing waiting — nothing changes until you accept"}
                </p>
              </div>
              <ListChecks aria-hidden="true" className="size-5 text-muted-foreground" />
            </div>
            {pendingProposals.length > 0 ? (
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {pendingProposals.slice(0, 5).map((proposal) => (
                  <li key={proposal.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate("Hermes Coach")}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{proposal.summary}</strong>
                        <span className="block truncate text-xs text-muted-foreground">
                          {proposal.kind === "initial" ? "First roadmap" : "Roadmap change"}
                          {proposal.created_at ? ` · ${timeAgo(proposal.created_at)}` : ""}
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => onNavigate("Hermes Coach")}
              className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open Hermes Coach <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </section>
        </motion.div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <motion.section
          aria-labelledby="today-sources"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15, ease: EASE_OUT }}
          className="rounded-2xl border border-border p-6 shadow-sm"
        >
          <h2 id="today-sources" className="text-xl font-semibold">Sources</h2>
          <p className="text-[13px] text-muted-foreground">
            {sources.length > 0
              ? `${sources.length} connected`
              : "No sources connected yet"}
          </p>
          {sources.length > 0 ? (
            <ul className="mt-3 divide-y divide-border border-t border-border">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      source.status === "ready" && "bg-emerald-500",
                      (source.status === "syncing" || source.status === "pending") && "bg-amber-500",
                      source.status === "failed" && "bg-red-500",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{source.label || prettyKind(source.kind)}</strong>
                    <span className="block truncate text-xs text-muted-foreground">
                      {prettyKind(source.kind)} · {source.status}
                      {source.status === "failed" && source.error ? ` — ${source.error}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">
              Connect GitHub, a transcript, or a portfolio so new evidence shows up here.
            </p>
          )}
          <button
            type="button"
            onClick={() => onNavigate("My data")}
            className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Manage sources <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </motion.section>

        <motion.section
          aria-labelledby="today-practice"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: EASE_OUT }}
          className="rounded-2xl border border-border p-6 shadow-sm"
        >
          <h2 id="today-practice" className="text-xl font-semibold">Practice</h2>
          <p className="text-[13px] text-muted-foreground">
            {practice.decks.length} {practice.decks.length === 1 ? "deck" : "decks"} · {practice.quizzes.length}{" "}
            {practice.quizzes.length === 1 ? "quiz" : "quizzes"} · {practice.extensions.length} slide{" "}
            {practice.extensions.length === 1 ? "extension" : "extensions"}
          </p>
          {practice.quizzes.length > 0 ? (
            <ul className="mt-3 divide-y divide-border border-t border-border">
              {practice.quizzes.slice(0, 4).map((quiz) => (
                <li key={quiz.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">{quiz.deckName}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {quiz.questions.length} {quiz.questions.length === 1 ? "question" : "questions"} · {quiz.difficulty}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">
              {practice.decks.length > 0
                ? "Decks are ready — generate a quiz to start practicing."
                : "Upload slides in Quizzes to build practice from your own decks."}
            </p>
          )}
          <button
            type="button"
            onClick={() => onNavigate("Quizzes")}
            className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open practice <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </motion.section>
      </div>
    </motion.div>
  )
}
