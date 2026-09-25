"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Database,
  ListChecks,
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

function emptyLibrary(): QuizLibrary {
  return { decks: [], quizzes: [], extensions: [] }
}

export function TodayView({ onNavigate }: TodayViewProps) {
  const studentId = getCurrentStudentId()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [nodes, setNodes] = useState<RoadmapNodeData[]>([])
  const [stages, setStages] = useState<RoadmapStage[]>([])
  const [displayName, setDisplayName] = useState("")
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [sources, setSources] = useState<DataSourceItem[]>([])
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
      setNodes(roadmap.snapshot.nodes)
      setStages(roadmap.snapshot.stages)
      if (profile) setDisplayName(profile.display_name)
      setEvidence(items)
      setProposals(pending)
      setSources(sourceItems.filter((item) => item.status !== "removed"))
      if (context && !profile && context.display_name) setDisplayName(context.display_name)
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

  const doneSet = useMemo(() => {
    const done = new Set<string>()
    for (const node of nodes) {
      if ((node.status ?? "not-started") === "done") done.add(node.id)
    }
    return done
  }, [nodes])

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
    for (const node of nodes) {
      if ((node.status ?? "not-started") === "done") done += 1
    }
    const total = nodes.length
    return {
      done,
      remaining: total - done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
    }
  }, [nodes])

  // Up next: the focus node plus the next 2 remaining topics. Full order lives in Roadmap.
  const upNext = useMemo(() => {
    if (!currentNode) return []
    const seen = new Set<string>([currentNode.id])
    const rest = nodes.filter((node) => {
      if (seen.has(node.id) || (node.status ?? "not-started") === "done") return false
      seen.add(node.id)
      return true
    })
    return [currentNode, ...rest].slice(0, 3)
  }, [nodes, currentNode])

  const suggestedCount = useMemo(
    () => evidence.filter((item) => item.status === "suggested").length,
    [evidence],
  )
  const pendingCount = useMemo(
    () => proposals.filter((item) => item.status === "pending").length,
    [proposals],
  )
  const failedSources = useMemo(
    () => sources.filter((item) => item.status === "failed"),
    [sources],
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

  // Single canonical progress line. Detailed counts live in Roadmap / My data.
  const statusLine = useMemo(() => {
    if (nodes.length === 0) return ""
    if (summary.done === summary.total) {
      return `All ${summary.total} topics done — ask Hermes Coach what's next.`
    }
    if (currentStage) {
      return `${summary.done} of ${summary.total} done · now in ${currentStage.title}`
    }
    return `${summary.done} of ${summary.total} topics done`
  }, [nodes.length, summary, currentStage])

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
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5" aria-label="Loading Today">
        <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-muted" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="h-72 animate-pulse rounded-3xl bg-muted" />
          <div className="grid content-start gap-4">
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          </div>
        </div>
      </div>
    )
  }

  if (error && nodes.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-6xl place-items-center px-4 py-10">
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
      <div className="mx-auto grid w-full max-w-6xl place-items-center px-4 py-10">
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
  const heroDetail = currentNode?.tagline || currentNode?.description || ""
  const heroSubtopics = currentNode?.subtopics.slice(0, 3) ?? []
  const heroExtraSubtopics = (currentNode?.subtopics.length ?? 0) - heroSubtopics.length
  const attentionCount = suggestedCount + pendingCount + failedSources.length
  const hasAttention = attentionCount > 0

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-5 sm:py-4"
    >
      {/* Header: orientation only. One progress line; details live in Roadmap. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {displayName ? `Today for ${displayName}` : "Today"}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{todayLabel} · {statusLine}</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("Roadmap")}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Route aria-hidden="true" className="size-4" /> {title || "Roadmap"}
          <span className="text-muted-foreground tabular-nums">· {summary.percent}%</span>
        </button>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* Primary column: the one decision — what to do next. */}
        <div className="grid content-start gap-3">
          <motion.section
            aria-labelledby="today-next"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="relative overflow-hidden rounded-2xl bg-primary p-4 text-primary-foreground sm:p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
              {statusLabel(currentStatus)}
              {currentNode?.duration ? ` · ${currentNode.duration}` : ""}
              {currentStage ? ` · ${currentStage.title}` : ""}
            </p>
            <h2 id="today-next" className="mt-1.5 max-w-md text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
              {currentNode?.title}
            </h2>
            {heroDetail ? (
              <p className="mt-1.5 max-w-xl text-[13px] opacity-80">{heroDetail}</p>
            ) : null}
            {heroSubtopics.length > 0 ? (
              <ul className="mt-2.5 space-y-1 text-[13px] opacity-90" aria-label="Key points in this step">
                {heroSubtopics.map((subtopic) => (
                  <li key={subtopic} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-primary-foreground/70" />
                    <span className="min-w-0">{subtopic}</span>
                  </li>
                ))}
                {heroExtraSubtopics > 0 ? (
                  <li className="text-[13px] opacity-70">+{heroExtraSubtopics} more in Roadmap</li>
                ) : null}
              </ul>
            ) : null}
            <div
              className="mt-3 h-1 overflow-hidden rounded-full bg-primary-foreground/20"
              role="progressbar"
              aria-valuenow={summary.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall roadmap progress"
            >
              <div className="h-full rounded-full bg-primary-foreground" style={{ width: `${summary.percent}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate("Roadmap")}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-primary-foreground px-4 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Continue <ArrowRight aria-hidden="true" className="size-4" />
              </button>
              {currentNode && currentStatus !== "done" ? (
                <button
                  type="button"
                  disabled={savingId === currentNode.id}
                  onClick={() => void setNodeStatus(currentNode.id, currentAction.next)}
                  className="inline-flex h-9 items-center rounded-full border border-primary-foreground/30 px-4 text-sm font-semibold outline-none hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {savingId === currentNode.id ? "Saving…" : currentAction.label}
                </button>
              ) : null}
            </div>
          </motion.section>

          {/* Up next: compact queue. Full order and actions live in Roadmap. */}
          <motion.section
            aria-labelledby="today-up-next"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: EASE_OUT }}
            className="rounded-2xl border border-border p-3 shadow-sm"
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 id="today-up-next" className="text-sm font-semibold">Up next</h2>
              <button
                type="button"
                onClick={() => onNavigate("Roadmap")}
                className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Full roadmap <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            <ul className="divide-y divide-border">
              {upNext.map((node, index) => {
                const status = (node.status ?? "not-started") as NodeStatus
                return (
                  <li key={node.id} className="flex items-center gap-2.5 py-1.5">
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold",
                        index === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {index === 0 ? "→" : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{node.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {node.duration} · {statusLabel(status)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </motion.section>
        </div>

        {/* Secondary column: only what needs a decision, plus shortcuts. */}
        <div className="grid content-start gap-3">
          <motion.section
            aria-labelledby="today-attention"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
            className="rounded-2xl border border-border p-3 shadow-sm"
          >
            <h2 id="today-attention" className="text-sm font-semibold">
              Needs attention
              {hasAttention ? (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {attentionCount}
                </span>
              ) : null}
            </h2>
            {!hasAttention ? (
              <p className="mt-1.5 flex items-start gap-2 text-[13px] text-muted-foreground">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                All clear. Nothing to review — pick up where you left off.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border">
                {failedSources.slice(0, 1).map((source) => (
                  <li key={source.id} className="py-1.5">
                    <button
                      type="button"
                      onClick={() => onNavigate("My data")}
                      className="group flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">Source failed to sync</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {source.label || source.kind} — fix in My data
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    </button>
                  </li>
                ))}
                {suggestedCount > 0 ? (
                  <li className="py-1.5">
                    <button
                      type="button"
                      onClick={() => onNavigate("My data")}
                      className="group flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {suggestedCount} {suggestedCount === 1 ? "record" : "records"} to review
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          Confirm or dismiss in My data
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    </button>
                  </li>
                ) : null}
                {pendingCount > 0 ? (
                  <li className="py-1.5">
                    <button
                      type="button"
                      onClick={() => onNavigate("Hermes Coach")}
                      className="group flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {pendingCount} {pendingCount === 1 ? "coach draft" : "coach drafts"} waiting
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          Nothing changes until you accept
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </motion.section>

          <motion.nav
            aria-label="Quick actions"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: EASE_OUT }}
            className="grid grid-cols-2 gap-2"
          >
            {[
              { label: "Ask Hermes", hint: "Coach", tab: "Hermes Coach", icon: Bot },
              { label: "Practice", hint: `${practice.quizzes.length} quizzes`, tab: "Quizzes", icon: ListChecks },
              { label: "My data", hint: "Sources", tab: "My data", icon: Database },
              { label: "Roadmap", hint: `${summary.remaining} left`, tab: "Roadmap", icon: Route },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => onNavigate(action.tab)}
                className="rounded-2xl border border-border p-2.5 text-left shadow-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <action.icon aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="mt-1.5 block text-sm font-semibold">{action.label}</span>
                <span className="block text-xs text-muted-foreground">{action.hint}</span>
              </button>
            ))}
          </motion.nav>
        </div>
      </div>
    </motion.div>
  )
}
