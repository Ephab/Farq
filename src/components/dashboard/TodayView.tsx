"use client"

import { createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react"
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
} from "@/lib/waypoint-api"
import { loadLibrary, type QuizLibrary } from "@/lib/quiz-store"
import { EASE_OUT, SPRING_MOUSE } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { OutlookView } from "@/components/outlook/OutlookView"

// Shape rule for this page: hero 32px, panels 24px, buttons and pills full round.
// Color rule: primary is the only accent. Emerald and amber appear only as
// real status (done, in progress, failed), never as decoration.

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

/** Panel heading: title stacked above supporting line, status pill on the right. */
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

/** Scroll reveal wrapper. Uses transform and opacity only. */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, delay, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Magnetic CTA. Pulls toward the cursor with spring physics, static when reduced motion. */
function MagneticButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  label,
}: {
  children: ReactNode
  onClick: () => void
  variant?: "primary" | "secondary" | "onDark" | "onDarkGhost"
  disabled?: boolean
  label?: string
}) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, SPRING_MOUSE)
  const sy = useSpring(y, SPRING_MOUSE)

  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={reduce ? undefined : { x: sx, y: sy }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      onMouseMove={(event) => {
        if (reduce) return
        const rect = event.currentTarget.getBoundingClientRect()
        x.set((event.clientX - (rect.left + rect.width / 2)) * 0.18)
        y.set((event.clientY - (rect.top + rect.height / 2)) * 0.22)
      }}
      onMouseLeave={() => {
        x.set(0)
        y.set(0)
      }}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-[18px] text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        variant === "primary" && "bg-primary text-primary-foreground shadow-sm hover:opacity-90",
        variant === "secondary" && "border border-border shadow-sm hover:bg-muted",
        variant === "onDark" && "bg-background text-foreground shadow-sm hover:opacity-90",
        variant === "onDarkGhost" && "border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10",
      )}
    >
      {children}
    </motion.button>
  )
}

/** Accent text link that reads as the row's own action. */
function RowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
        className="h-full w-full origin-left rounded-full bg-primary"
        initial={false}
        animate={{ scaleX: Math.max(0, Math.min(1, percent / 100)) }}
        transition={{ duration: 0.7, ease: EASE_OUT }}
      />
    </div>
  )
}

/** Live stage ring drawn from real progress. The honest visual for the hero. */
function StageRing({ percent, done, total }: { percent: number; done: number; total: number }) {
  const reduce = useReducedMotion()
  const R = 52
  const C = 2 * Math.PI * R
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = C - (clamped / 100) * C
  return (
    <div
      role="img"
      aria-label={`Stage progress ${clamped} percent, ${done} of ${total} done`}
      className="relative grid shrink-0 place-items-center"
    >
      <svg width="148" height="148" viewBox="0 0 120 120" aria-hidden="true" className="block">
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--primary-foreground)"
          strokeOpacity="0.22"
          strokeWidth="10"
        />
        <motion.circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--primary-foreground)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          transform="rotate(-90 60 60)"
          initial={reduce ? false : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: EASE_OUT }}
        />
      </svg>
      <div className="absolute text-center text-primary-foreground">
        <p className="text-[26px] font-bold leading-none tracking-tight">{clamped}%</p>
        <p className="mt-1 text-xs opacity-75">
          {done} of {total} done
        </p>
      </div>
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

  /** Progress inside the current stage, the roadmap page owns the whole plan number. */
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

  /** One honest sentence. No forecasts, no invented pacing. Keeps to 20 words. */
  const headline = useMemo(() => {
    const donePart = `${summary.done} of ${summary.total} topics done`
    if (failedSources.length > 0) {
      const s = failedSources.length === 1 ? "" : "s"
      return `${donePart}. ${failedSources.length} source${s} failed to sync.`
    }
    const waiting: string[] = []
    if (suggestedCount > 0) {
      waiting.push(`${suggestedCount} record${suggestedCount === 1 ? "" : "s"} to review`)
    }
    if (pendingProposals.length > 0) {
      waiting.push(`${pendingProposals.length} draft${pendingProposals.length === 1 ? "" : "s"} to accept`)
    }
    if (waiting.length === 0) return `${donePart}.`
    return `${donePart}. ${waiting.join(" and ")}.`
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
          ? `Waiting for review, ${timeAgo(at)}`
          : `${proposal.status === "accepted" ? "Accepted" : "Dismissed"}, ${timeAgo(at)}`,
        at,
        tab: "Hermes Coach",
        action: pending ? "Review drafts" : "Open coach",
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
        action: "Open records",
      })
    }
    for (const deck of practice.decks) {
      items.push({
        id: `deck-${deck.id}`,
        icon: <Presentation className="size-[18px]" />,
        title: deck.fileName,
        detail: `${timeAgo(deck.uploadedAt)}, ${deck.units} pages read`,
        at: deck.uploadedAt,
        tab: "Slides",
        action: "Open slides",
      })
    }
    for (const quiz of practice.quizzes) {
      items.push({
        id: `quiz-${quiz.id}`,
        icon: <ListChecks className="size-[18px]" />,
        title: `Practice set from ${quiz.deckName}`,
        detail: `${timeAgo(quiz.createdAt)}, ${quiz.questions.length} questions, ${quiz.difficulty}`,
        at: quiz.createdAt,
        tab: "Quizzes",
        action: "Open practice",
      })
    }
    for (const extension of practice.extensions) {
      items.push({
        id: `extension-${extension.id}`,
        icon: <Sparkles className="size-[18px]" />,
        title: `Slides expanded: ${extension.topic}`,
        detail: `${timeAgo(extension.createdAt)}, from ${extension.deckName}`,
        at: extension.createdAt,
        tab: "Slides",
        action: "Open slides",
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
        detail: source.error || "Waypoint could not read this source",
        tab: "My data",
        action: "Fix source",
      })
    }
    if (suggestedCount > 0) {
      rows.push({
        id: "attention-evidence",
        icon: <Inbox className="size-[18px]" />,
        title: `${suggestedCount} ${suggestedCount === 1 ? "record" : "records"} to review`,
        detail: "Imported evidence stays pending until you confirm it",
        tab: "My data",
        action: "Review records",
      })
    }
    if (pendingProposals.length > 0) {
      rows.push({
        id: "attention-proposals",
        icon: <Sparkles className="size-[18px]" />,
        title: `${pendingProposals.length} roadmap ${pendingProposals.length === 1 ? "draft" : "drafts"} waiting`,
        detail: "Completed and in-progress topics stay untouched",
        tab: "Hermes Coach",
        action: "Review drafts",
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
        <div className="mt-8 animate-pulse rounded-[32px] bg-muted p-6 sm:p-8">
          <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div>
              <div className="h-7 w-40 rounded-full bg-background/60" />
              <div className="mt-6 h-10 w-3/4 rounded-2xl bg-background/60" />
              <div className="mt-3 h-5 w-1/2 rounded-full bg-background/60" />
              <div className="mt-8 flex gap-3">
                <div className="h-11 w-36 rounded-full bg-background/60" />
                <div className="h-11 w-28 rounded-full bg-background/40" />
              </div>
            </div>
            <div className="mx-auto size-[148px] rounded-full bg-background/40" />
          </div>
        </div>
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
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
          <p className="text-xs font-bold text-primary">Today</p>
          <h1 className="mt-2 text-[clamp(28px,4vw,44px)] font-bold leading-[1.05] tracking-tight">
            No roadmap yet{displayName ? `, ${displayName}` : ""}.
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            This page fills in once a roadmap exists. Ask Hermes to build one from your records, or add
            a source in My data first.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <MagneticButton variant="primary" onClick={() => onNavigate("Hermes Coach")}>
              Ask Hermes <ArrowRight aria-hidden="true" className="size-4" />
            </MagneticButton>
            <MagneticButton variant="secondary" onClick={() => onNavigate("My data")}>
              Add records
            </MagneticButton>
          </div>
        </div>
        <div className="mt-10 w-full max-w-md">
          <OutlookView compact onOpen={() => onNavigate("Emails")} />
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
        {/* Header: date, promise, plan in one short line. */}
        <div className="min-w-0 max-w-[72ch]">
          <p className="mb-2.5 text-xs font-bold text-primary">{todayLabel}</p>
          <h1 className="text-[clamp(30px,4vw,52px)] font-bold leading-[1.03] tracking-tight">
            {complete ? "Roadmap complete." : "One useful step today."}
          </h1>
          <p className="mt-2.5 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">{headline}</p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
          >
            {error}
          </p>
        ) : null}

        {/* Focus hero: asymmetric split, live stage ring on the right. */}
        <Reveal className="mt-8" delay={0}>
          <section
            aria-label="Your next step"
            className="relative overflow-hidden rounded-[32px] bg-primary p-6 text-primary-foreground shadow-lg sm:p-8 lg:p-10"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-28 -right-20 size-[310px] rounded-full bg-primary-foreground/10 blur-3xl"
            />
            {!reduce ? (
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute -left-24 -top-24 size-[260px] rounded-full bg-primary-foreground/10 blur-3xl"
                animate={{ y: [0, -14, 0], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : null}
            <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="min-w-0">
                <Pill tone="inverse">
                  {currentNode
                    ? `${STATUS_LABEL[currentStatus]}${currentNode.duration ? `, ${currentNode.duration}` : ""}`
                    : `All ${summary.total} ${summary.total === 1 ? "topic" : "topics"} done`}
                </Pill>
                <h2 className="mt-6 max-w-[16ch] text-[clamp(28px,3.6vw,44px)] font-bold leading-[1.05] tracking-tight">
                  {currentNode?.title ?? "Every topic is done"}
                </h2>
                <p className="mt-2.5 max-w-[52ch] text-[15px] leading-relaxed opacity-75">
                  {currentNode
                    ? currentNode.tagline || currentNode.description
                    : "This roadmap has nothing left to do. Ask Hermes Coach what to learn next."}
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-2.5">
                  {currentNode ? (
                    <>
                      <MagneticButton variant="onDark" onClick={() => onNavigate("Roadmap")}>
                        Continue topic <ArrowRight aria-hidden="true" className="size-4" />
                      </MagneticButton>
                      <MagneticButton
                        variant="onDarkGhost"
                        disabled={savingId === currentNode.id}
                        onClick={() => void setNodeStatus(currentNode.id, currentAction.next)}
                      >
                        {savingId === currentNode.id ? "Saving" : currentAction.label}
                      </MagneticButton>
                    </>
                  ) : (
                    <MagneticButton variant="onDark" onClick={() => onNavigate("Hermes Coach")}>
                      Ask Hermes <ArrowRight aria-hidden="true" className="size-4" />
                    </MagneticButton>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-center gap-4 lg:items-end">
                <StageRing percent={stageProgress.percent} done={stageProgress.done} total={stageProgress.total} />
                <p className="max-w-[32ch] text-center text-[13px] leading-relaxed opacity-75 lg:text-right">
                  {currentStage?.title ?? "Current stage"}
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* Queue and plan health: stacked list next to display number. */}
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <Reveal delay={0.05} className="h-full">
            <Panel label="Up next" className="h-full">
              <PanelHead
                title="Up next"
                sub={
                  summary.remaining > 0
                    ? `${summary.remaining} ${summary.remaining === 1 ? "topic" : "topics"} left`
                    : "Everything is done"
                }
              />
              {upNext.length === 0 ? (
                <p className="mt-4 flex items-start gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  Every topic in {title || "this roadmap"} is done. Ask Hermes Coach what to learn next.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {upNext.map((node, index) => {
                    const status = statusOf(node)
                    return (
                      <motion.li
                        key={node.id}
                        initial={reduce ? false : { opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{ duration: 0.5, delay: index * 0.06, ease: EASE_OUT }}
                        className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3"
                      >
                        <span
                          aria-hidden="true"
                          className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-background text-primary shadow-sm"
                        >
                          {topicGlyph(node.icon)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold" title={node.title}>
                            {node.title}
                          </span>
                          <span
                            className="block truncate text-xs text-muted-foreground"
                            title={`${node.duration}, ${node.level}`}
                          >
                            {node.duration}, {node.level}
                          </span>
                        </span>
                        {index === 0 ? (
                          <Pill tone="warning">Now</Pill>
                        ) : (
                          <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
                        )}
                      </motion.li>
                    )
                  })}
                </ul>
              )}
            </Panel>
          </Reveal>

          <div className="space-y-5">
            <Reveal delay={0.1}>
              <Panel label="Roadmap momentum">
                <PanelHead
                  title="Roadmap momentum"
                  sub={title || "Your plan"}
                  tone={stagePill.tone}
                  pill={stagePill.label}
                />
                <p className="mt-5 text-[34px] font-bold leading-none tracking-tight">
                  {stageProgress.percent}
                  <span className="text-lg font-semibold text-muted-foreground">%</span>
                </p>
                <div className="mt-3">
                  <ProgressTrack percent={stageProgress.percent} label={`${currentStage?.title ?? "Current stage"} progress`} />
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                  {currentStage?.title ?? "Current stage"}, {stageProgress.done} of {stageProgress.total} done
                </p>
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-background text-primary shadow-sm"
                  >
                    {currentNode ? topicGlyph(currentNode.icon) : <Route className="size-[18px]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold" title={version ? `Plan version ${version}` : "Current plan"}>
                      {version ? `Plan version ${version}` : "Current plan"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {reason || `${stages.length} ${stages.length === 1 ? "stage" : "stages"}, ${summary.total} ${summary.total === 1 ? "topic" : "topics"}`}
                    </span>
                  </span>
                </div>
              </Panel>
            </Reveal>

            <Reveal delay={0.12}>
              <OutlookView compact onOpen={() => onNavigate("Emails")} />
            </Reveal>
          </div>
        </div>

        {/* What moved: simple feed, newest first. */}
        <Reveal delay={0.15} className="mt-5">
          <Panel label="What changed">
            <PanelHead title="What changed" />
            {activity.length === 0 ? (
              <p className="mt-4 flex items-start gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
                <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                Nothing yet. Sync a source, upload a deck, or ask Hermes to change your plan. It shows
                up here.
              </p>
            ) : (
              <ul className="mt-4 grid gap-x-8 gap-y-1 md:grid-cols-2">
                {activity.map((item, index) => (
                  <motion.li
                    key={item.id}
                    initial={reduce ? false : { opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.5, delay: Math.min(index * 0.05, 0.2), ease: EASE_OUT }}
                    className="flex items-center gap-3 rounded-2xl p-2"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-muted text-primary"
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold" title={item.title}>
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground" title={item.detail}>
                        {item.detail}
                      </span>
                    </span>
                    <RowLink onClick={() => onNavigate(item.tab)}>
                      {item.action} <ArrowRight aria-hidden="true" className="size-3.5" />
                    </RowLink>
                  </motion.li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>

        {/* Only when something is genuinely waiting on the student. */}
        {attention.length > 0 ? (
          <Reveal delay={0.2} className="mt-5">
            <Panel label="Needs attention">
              <PanelHead
                title="Needs attention"
                tone="warning"
                pill={`${attention.length}`}
              />
              <ul className="mt-4 grid gap-2.5 md:grid-cols-2">
                {attention.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-background text-primary shadow-sm"
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold" title={item.title}>
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground" title={item.detail}>
                        {item.detail}
                      </span>
                    </span>
                    <RowLink onClick={() => onNavigate(item.tab)}>
                      {item.action} <ArrowRight aria-hidden="true" className="size-3.5" />
                    </RowLink>
                  </li>
                ))}
              </ul>
            </Panel>
          </Reveal>
        ) : null}
      </motion.div>
    </div>
  )
}
