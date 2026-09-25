"use client"

import { createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowRight,
  CircleCheck,
  CircleSlash,
  Database,
  Inbox,
  ListChecks,
  Presentation,
  Route,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import type { NodeStatus, RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap"
import { nodeIcon } from "@/components/roadmap/roadmap-icons"
import {
  api,
  getCurrentStudentId,
  notifyRoadmapChanged,
  ROADMAP_CHANGED_EVENT,
  SOURCE_KIND_LABEL,
  type DataSourceItem,
  type EvidenceItem,
  type StudentProfile,
} from "@/lib/farq-api"
import { loadLibrary, type QuizLibrary } from "@/lib/quiz-store"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

interface RoadmapResponse {
  version: number | string
  reason?: string
  snapshot: { title: string; nodes: RoadmapNodeData[]; stages: RoadmapStage[] }
}

interface ProposalSummary {
  id: string
  summary: string
  kind: string
  status: string
  created_at: string
}

/** What the API sends back so the panel can name the student without a second call. */
interface ContextResponse {
  display_name: string
}

interface TodayViewProps {
  onNavigate: (tab: string) => void
}

type Tone = "neutral" | "inverse" | "accent" | "success" | "warning"

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  inverse: "bg-primary-foreground/15 text-primary-foreground",
  accent: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
}

const STATUS_TONE: Record<NodeStatus, Tone> = {
  done: "success",
  "in-progress": "warning",
  "not-started": "neutral",
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  done: "Done",
  "in-progress": "In progress",
  "not-started": "Up next",
}

function statusOf(node: RoadmapNodeData): NodeStatus {
  return (node.status ?? "not-started") as NodeStatus
}

/** The node's own roadmap icon, drawn the way RoadmapNode draws it. */
function topicGlyph(icon: string, className = "size-[18px]") {
  return createElement(nodeIcon(icon), { className, "aria-hidden": true })
}

/** The one status change a student can make from this page. */
function nextAction(status: NodeStatus): { label: string; next: NodeStatus } {
  if (status === "in-progress") return { label: "Mark done", next: "done" }
  if (status === "done") return { label: "Reopen topic", next: "in-progress" }
  return { label: "Start topic", next: "in-progress" }
}

/** Backend timestamps are UTC ISO strings; SQLite can drop the offset. */
function parseTime(value: string | number): number | null {
  const raw = typeof value === "number" ? value : Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`)
  return Number.isFinite(raw) ? raw : null
}

/** A source saved without a value of its own is stored with the kind as its label. */
function sourceName(source: DataSourceItem): string {
  const label = source.label?.trim()
  return label && label !== source.kind ? label : SOURCE_KIND_LABEL[source.kind]
}

function timeAgo(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 9) return `${weeks} w ago`
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  )
}

function Panel({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={cn("rounded-3xl border border-border bg-background p-5 shadow-sm sm:p-6", className)}
    >
      {children}
    </section>
  )
}

/** Panel heading: title, optional supporting line, optional status on the right. */
function PanelHead({
  title,
  sub,
  tone,
  pill,
}: {
  title: string
  sub?: ReactNode
  tone?: Tone
  pill?: string
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold leading-snug tracking-tight">{title}</h2>
        {sub ? <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p> : null}
      </div>
      {pill ? <Pill tone={tone}>{pill}</Pill> : null}
    </div>
  )
}

/** Icon tile + copy + trailing slot. The trailing slot owns the row's only action. */
function ListRow({
  icon,
  title,
  detail,
  trailing,
  divider = true,
}: {
  icon: ReactNode
  title: string
  detail: ReactNode
  trailing?: ReactNode
  divider?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5",
        divider && "border-b border-border last:border-b-0",
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-muted text-primary"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {trailing}
    </div>
  )
}

/** Accent text link that reads as the row's own action. */
function RowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function ProgressTrack({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="h-[7px] overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={false}
        animate={{ width: `${percent}%` }}
        transition={{ duration: 0.7, ease: EASE_OUT }}
      />
    </div>
  )
}

/** A row the student can act on. Its link lives in the trailing slot. */
interface ActionRow {
  id: string
  icon: ReactNode
  title: string
  detail: string
  tab: string
  action: string
}

/** One timestamped thing that really happened. */
interface ActivityItem extends ActionRow {
  at: number
}

function emptyLibrary(): QuizLibrary {
  return { decks: [], quizzes: [], extensions: [] }
}

export function TodayView({ onNavigate }: TodayViewProps) {
  const studentId = getCurrentStudentId()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [version, setVersion] = useState<number | string | null>(null)
  const [reason, setReason] = useState("")
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
      setTitle(roadmap.snapshot.title)
      setVersion(roadmap.version)
      setReason(roadmap.reason ?? "")
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
      if (statusOf(node) === "done") done.add(node.id)
    }
    return done
  }, [nodes])

  const summary = useMemo(() => {
    let done = 0
    for (const node of nodes) {
      if (statusOf(node) === "done") done += 1
    }
    return { done, total: nodes.length, remaining: nodes.length - done }
  }, [nodes])

  const complete = summary.total > 0 && summary.remaining === 0

  /** The single topic this page is about: in progress, else the first unlocked one.
   *  Null when there is nothing left to work on. */
  const currentNode = useMemo<RoadmapNodeData | null>(() => {
    if (nodes.length === 0) return null
    const inProgress = nodes.find((node) => statusOf(node) === "in-progress")
    if (inProgress) return inProgress
    const ready = nodes.find(
      (node) => statusOf(node) === "not-started" && (node.deps ?? []).every((dep) => doneSet.has(dep)),
    )
    return ready ?? nodes.find((node) => statusOf(node) !== "done") ?? null
  }, [nodes, doneSet])

  const currentStage = useMemo<RoadmapStage | null>(() => {
    if (!currentNode) return stages[0] ?? null
    return stages.find((stage) => stage.nodeIds.includes(currentNode.id)) ?? stages[0] ?? null
  }, [currentNode, stages])

  /** Progress inside the current stage — the roadmap page owns the whole-plan number. */
  const stageProgress = useMemo(() => {
    const ids = currentStage?.nodeIds ?? []
    const members = nodes.filter((node) => ids.includes(node.id))
    const done = members.filter((node) => statusOf(node) === "done").length
    return {
      done,
      total: members.length,
      percent: members.length ? Math.round((done / members.length) * 100) : 0,
    }
  }, [currentStage, nodes])

  /** The focus topic plus the two topics queued behind it. */
  const upNext = useMemo(() => {
    if (!currentNode) return []
    const seen = new Set<string>([currentNode.id])
    const rest = nodes.filter((node) => {
      if (seen.has(node.id) || statusOf(node) === "done") return false
      seen.add(node.id)
      return true
    })
    return [currentNode, ...rest].slice(0, 3)
  }, [nodes, currentNode])

  const suggestedCount = useMemo(
    () => evidence.filter((item) => item.status === "suggested").length,
    [evidence],
  )
  const pendingProposals = useMemo(
    () => proposals.filter((item) => item.status === "pending"),
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

  /** One honest sentence per state. No forecasts, no invented pacing. */
  const headline = useMemo(() => {
    const parts = [`${summary.done} of ${summary.total} topics done`]
    const waiting: string[] = []
    if (suggestedCount > 0) {
      waiting.push(`${suggestedCount} new ${suggestedCount === 1 ? "record" : "records"} to review`)
    }
    if (pendingProposals.length > 0) {
      waiting.push(
        `${pendingProposals.length} roadmap ${pendingProposals.length === 1 ? "draft" : "drafts"} to accept`,
      )
    }
    if (failedSources.length > 0) {
      parts.push(`${failedSources.length} ${failedSources.length === 1 ? "source" : "sources"} failed to sync`)
    }
    if (waiting.length > 0) parts.push(waiting.join(" and "))
    return `${parts.join(" · ")}.`
  }, [summary, suggestedCount, pendingProposals.length, failedSources.length])

  /** Everything that really changed, newest first. Empty means genuinely nothing yet. */
  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = []
    for (const proposal of proposals) {
      const at = parseTime(proposal.created_at)
      if (at === null) continue
      const pending = proposal.status === "pending"
      items.push({
        id: `proposal-${proposal.id}`,
        icon: pending ? <Sparkles className="size-[18px]" /> : <CircleCheck className="size-[18px]" />,
        title: proposal.summary,
        detail: pending
          ? `Waiting for you · ${timeAgo(at)}`
          : `${proposal.status === "accepted" ? "Accepted" : "Dismissed"} · ${timeAgo(at)}`,
        at,
        tab: "Hermes Coach",
        action: pending ? "Review" : "View",
      })
    }
    for (const source of sources) {
      if (source.status !== "ready" || !source.last_synced_at) continue
      const at = parseTime(source.last_synced_at)
      if (at === null) continue
      items.push({
        id: `source-${source.id}`,
        icon: <Database className="size-[18px]" />,
        title: `${sourceName(source)} synced`,
        detail: timeAgo(at),
        at,
        tab: "My data",
        action: "Open",
      })
    }
    for (const deck of practice.decks) {
      items.push({
        id: `deck-${deck.id}`,
        icon: <Presentation className="size-[18px]" />,
        title: deck.fileName,
        detail: `${timeAgo(deck.uploadedAt)} · ${deck.units} pages read`,
        at: deck.uploadedAt,
        tab: "Slides",
        action: "Open",
      })
    }
    for (const quiz of practice.quizzes) {
      items.push({
        id: `quiz-${quiz.id}`,
        icon: <ListChecks className="size-[18px]" />,
        title: `Practice set from ${quiz.deckName}`,
        detail: `${timeAgo(quiz.createdAt)} · ${quiz.questions.length} questions · ${quiz.difficulty}`,
        at: quiz.createdAt,
        tab: "Quizzes",
        action: "Practise",
      })
    }
    for (const extension of practice.extensions) {
      items.push({
        id: `extension-${extension.id}`,
        icon: <Sparkles className="size-[18px]" />,
        title: `Slides expanded: ${extension.topic}`,
        detail: `${timeAgo(extension.createdAt)} · from ${extension.deckName}`,
        at: extension.createdAt,
        tab: "Slides",
        action: "Open",
      })
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 4)
  }, [proposals, sources, practice])

  /** Only rendered when something is genuinely waiting on the student. */
  const attention = useMemo<ActionRow[]>(() => {
    const rows: ActionRow[] = []
    for (const source of failedSources) {
      rows.push({
        id: `failed-${source.id}`,
        icon: <TriangleAlert className="size-[18px]" />,
        title: `${sourceName(source)} failed to sync`,
        detail: source.error || "Farq could not read this source",
        tab: "My data",
        action: "Fix",
      })
    }
    if (suggestedCount > 0) {
      rows.push({
        id: "attention-evidence",
        icon: <Inbox className="size-[18px]" />,
        title: `${suggestedCount} ${suggestedCount === 1 ? "record" : "records"} to review`,
        detail: "Imported evidence only becomes yours when you confirm it",
        tab: "My data",
        action: "Review",
      })
    }
    if (pendingProposals.length > 0) {
      rows.push({
        id: "attention-proposals",
        icon: <Sparkles className="size-[18px]" />,
        title: `${pendingProposals.length} roadmap ${pendingProposals.length === 1 ? "draft" : "drafts"} waiting`,
        detail: "Completed and in-progress topics are never changed",
        tab: "Hermes Coach",
        action: "Review",
      })
    }
    return rows
  }, [failedSources, suggestedCount, pendingProposals.length])

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

  const retry = () => {
    setLoading(true)
    void load()
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-8 sm:py-10" aria-label="Loading Today">
        <div className="h-4 w-32 animate-pulse rounded-full bg-muted" />
        <div className="mt-3 h-11 w-2/3 animate-pulse rounded-2xl bg-muted" />
        <div className="mt-4 h-5 w-1/2 animate-pulse rounded-full bg-muted" />
        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <div className="h-[330px] animate-pulse rounded-[32px] bg-muted" />
          <div className="h-[330px] animate-pulse rounded-3xl bg-muted" />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <div className="h-56 animate-pulse rounded-3xl bg-muted" />
          <div className="h-56 animate-pulse rounded-3xl bg-muted" />
        </div>
      </div>
    )
  }

  if (error && nodes.length === 0) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 py-10">
        <div className="text-center">
          <p className="text-sm font-semibold">Today could not load</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 py-10">
        <div className="max-w-[46ch] text-center">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Today</p>
          <h1 className="mt-2 text-[clamp(28px,4vw,44px)] font-bold leading-[1.05] tracking-tight">
            No roadmap yet{displayName ? `, ${displayName}` : ""}.
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            This page fills in once a roadmap exists. Ask Hermes to build one from your records, or add
            a source in My data first.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate("Hermes Coach")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ask Hermes <ArrowRight aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("My data")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add records
            </button>
          </div>
        </div>
      </div>
    )
  }

  const currentStatus = currentNode ? statusOf(currentNode) : "not-started"
  const currentAction = nextAction(currentStatus)
  const stagePill: { tone: Tone; label: string } =
    stageProgress.total === 0
      ? { tone: "neutral", label: "No topics" }
      : stageProgress.done === stageProgress.total
        ? { tone: "success", label: "Stage complete" }
        : stageProgress.done > 0
          ? { tone: "accent", label: "In progress" }
          : { tone: "neutral", label: "Not started" }

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-8 sm:py-10"
      >
      {/* Header: the date, the promise, and the plan in one line. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2.5 text-xs font-bold text-primary">{todayLabel}</p>
          <h1 className="text-[clamp(30px,4vw,52px)] font-bold leading-[1.03] tracking-tight">
            {complete ? "Roadmap complete." : "One useful step today."}
          </h1>
          <p className="mt-2.5 max-w-[62ch] text-[15px] text-muted-foreground">{headline}</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("Roadmap")}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-[18px] text-sm font-semibold shadow-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Route aria-hidden="true" className="size-4" />
          View roadmap
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
        >
          {error}
        </p>
      ) : null}

      {/* The one decision, plus the queue behind it. */}
      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <motion.section
          aria-label="Your next step"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          className="relative flex min-h-[330px] flex-col overflow-hidden rounded-[32px] bg-primary p-6 text-primary-foreground shadow-lg sm:p-8 lg:p-10"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 -right-20 size-[310px] rounded-full bg-primary-foreground/10 blur-3xl"
          />
          <div className="relative flex flex-1 flex-col">
            <Pill tone="inverse">
              {currentNode
                ? `${STATUS_LABEL[currentStatus]}${currentNode.duration ? ` · ${currentNode.duration}` : ""}`
                : `All ${summary.total} ${summary.total === 1 ? "topic" : "topics"} done`}
            </Pill>
            <h2 className="mt-10 max-w-[16ch] text-[clamp(28px,3.6vw,44px)] font-bold leading-[1.05] tracking-tight">
              {currentNode?.title ?? "Every topic is done"}
            </h2>
            <p className="mt-2.5 max-w-[52ch] text-[15px] opacity-75">
              {currentNode
                ? currentNode.tagline || currentNode.description
                : "This roadmap has nothing left to do. Ask Hermes Coach what to learn next."}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-8">
              {currentNode ? (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate("Roadmap")}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-background px-[18px] text-sm font-semibold text-foreground shadow-sm outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Continue topic <ArrowRight aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={savingId === currentNode.id}
                    onClick={() => void setNodeStatus(currentNode.id, currentAction.next)}
                    className="inline-flex min-h-11 items-center rounded-full border border-primary-foreground/30 px-[18px] text-sm font-semibold outline-none hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {savingId === currentNode.id ? "Saving…" : currentAction.label}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate("Hermes Coach")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-background px-[18px] text-sm font-semibold text-foreground shadow-sm outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Ask Hermes Coach <ArrowRight aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
          </div>
        </motion.section>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05, ease: EASE_OUT }}
        >
          <Panel label="Up next" className="h-full">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
              <span>Up next</span>
              {summary.remaining > 0 ? (
                <span className="inline-flex items-center before:mr-2 before:size-[3px] before:rounded-full before:bg-muted-foreground/50 before:content-['']">
                  {summary.remaining} {summary.remaining === 1 ? "topic" : "topics"} left
                </span>
              ) : null}
            </div>
            {upNext.length === 0 ? (
              <p className="mt-4 flex items-start gap-2.5 text-[13px] text-muted-foreground">
                <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Every topic in {title || "this roadmap"} is done. Ask Hermes Coach what to learn next.
              </p>
            ) : (
              <ul className="mt-3">
                {upNext.map((node, index) => {
                  const status = statusOf(node)
                  return (
                    <li key={node.id}>
                      <ListRow
                        icon={topicGlyph(node.icon)}
                        title={node.title}
                        detail={`${node.duration} · ${node.level}`}
                        trailing={
                          index === 0 ? (
                            <Pill tone="warning">Now</Pill>
                          ) : (
                            <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
                          )
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </motion.div>
      </div>

      {/* Plan health, and what actually moved. */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: EASE_OUT }}
        >
          <Panel label="Roadmap momentum" className="h-full">
            <PanelHead
              title="Roadmap momentum"
              sub={title || "Your plan"}
              tone={stagePill.tone}
              pill={stagePill.label}
            />
            <div className="mt-5">
              <ProgressTrack percent={stageProgress.percent} label={`${currentStage?.title ?? "Current stage"} progress`} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
              <span>{currentStage?.title ?? "Current stage"}</span>
              <span className="inline-flex items-center before:mr-2 before:size-[3px] before:rounded-full before:bg-muted-foreground/50 before:content-['']">
                {stageProgress.done} of {stageProgress.total} done
              </span>
            </div>
            <ul className="mt-3">
              <li>
                <ListRow
                  icon={currentNode ? topicGlyph(currentNode.icon) : <Route className="size-[18px]" />}
                  title={version ? `Plan version ${version}` : "Current plan"}
                  detail={
                    reason ||
                    `${stages.length} ${stages.length === 1 ? "stage" : "stages"} · ${summary.total} ${summary.total === 1 ? "topic" : "topics"}`
                  }
                  trailing={<RowLink onClick={() => onNavigate("Roadmap")}>Open →</RowLink>}
                />
              </li>
            </ul>
          </Panel>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15, ease: EASE_OUT }}
        >
          <Panel label="What changed" className="h-full">
            <PanelHead title="What changed" sub="Only things that really happened" />
            {activity.length === 0 ? (
              <p className="mt-4 flex items-start gap-2.5 text-[13px] text-muted-foreground">
                <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                Nothing yet. Sync a source, upload a deck, or ask Hermes to change your plan — it shows
                up here.
              </p>
            ) : (
              <ul className="mt-3">
                {activity.map((item) => (
                  <li key={item.id}>
                    <ListRow
                      icon={item.icon}
                      title={item.title}
                      detail={item.detail}
                      trailing={<RowLink onClick={() => onNavigate(item.tab)}>{item.action} →</RowLink>}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </motion.div>
      </div>

      {/* Only when something is genuinely waiting on the student. */}
      {attention.length > 0 ? (
        <motion.section
          aria-label="Needs attention"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: EASE_OUT }}
          className="mt-5"
        >
          <Panel label="Needs attention">
            <PanelHead
              title="Needs attention"
              sub="Nothing changes until you decide"
              tone="warning"
              pill={`${attention.length}`}
            />
            <ul className="mt-3 grid gap-x-8 gap-y-1 md:grid-cols-2">
              {attention.map((item) => (
                <li key={item.id}>
                  <ListRow
                    divider={false}
                    icon={item.icon}
                    title={item.title}
                    detail={item.detail}
                    trailing={<RowLink onClick={() => onNavigate(item.tab)}>{item.action} →</RowLink>}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </motion.section>
      ) : null}
      </motion.div>
    </div>
  )
}
