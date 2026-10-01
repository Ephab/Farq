"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { parseServerTime } from "@/lib/server-time"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { RotateCcw, Sparkles, Trophy } from "lucide-react"
import { ChatThreadView, type SuggestedPrompt } from "@/components/hermes/ChatThreadView"
import { CoachPortalIntro, type PortalPhase } from "@/components/animation/CoachPortalIntro"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { api, getCurrentStudentId, notifyRoadmapChanged, type OpportunitySummary, type StudentProfile } from "@/lib/waypoint-api"
import { EASE_OUT } from "@/lib/ease"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import "./coach-concept.css"

interface Fact { id: string; category: string; key: string; value: unknown }
interface ProposalOperation { type: string; node_id: string; changes?: Record<string, unknown> }
interface Proposal {
  id: string; summary: string; reasoning: string; status: "pending" | "accepted" | "rejected"; kind?: "ops" | "initial"
  operations: ProposalOperation[]; created_at?: string
}
interface RoadmapNode { id: string; title: string; status?: string; deps?: string[] }
interface RoadmapResponse { snapshot: { title: string; nodes: RoadmapNode[] } }

function formatFactValue(value: unknown): string {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : String(item)}`).join(" · ")
  }
  return String(value)
}

function humanizeId(id: string): string {
  return id.replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").trim() || id
}

// Operation types are API enums; only the display label is translated.
function opMeta(type: string): { symbol: string; label: MessageKey } {
  switch (type) {
    case "add_node": return { symbol: "+", label: "coach.proposal.ops.add" }
    case "remove_node": return { symbol: "−", label: "coach.proposal.ops.remove" }
    case "move_node": return { symbol: "→", label: "coach.proposal.ops.move" }
    case "set_dependencies": return { symbol: "→", label: "coach.proposal.ops.deps" }
    default: return { symbol: "↺", label: "coach.proposal.ops.update" }
  }
}

function opDetail(operation: ProposalOperation): string {
  const changes = operation.changes ?? {}
  const title = typeof changes.title === "string" && changes.title.trim() ? changes.title.trim() : null
  if (title) return title
  return humanizeId(operation.node_id)
}

// Fact categories are server data (free text), so the summary keeps them as-is
// and only localizes the numbers and list joining.
function factCounts(facts: Fact[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const fact of facts) counts.set(fact.category, (counts.get(fact.category) ?? 0) + 1)
  return [...counts.entries()].slice(0, 3)
}

const TOPIC_STATUS_KEYS: Record<string, MessageKey> = {
  "in-progress": "coach.context.status.in-progress",
  "not-started": "coach.context.status.not-started",
  done: "coach.context.status.done",
}

// Session flag: the portal intro plays on the first Coach visit only. The
// coach stays mounted across tab switches (App hides it instead of
// unmounting), so this guards the once-per-session veil; per-visit replays
// honor the opt-in below.
let portalPlayed = false

const INTRO_EVERY_VISIT_KEY = "waypoint.coach-intro-every-visit"

function readIntroEveryVisit(): boolean {
  try {
    return window.localStorage.getItem(INTRO_EVERY_VISIT_KEY) === "1"
  } catch {
    return false
  }
}

export function HermesCoach({ initialDraft = "", onConsumeDraft, visible = true }: { initialDraft?: string; onConsumeDraft?: () => void; visible?: boolean }) {
  const { t, fmt } = useI18n()
  const studentId = getCurrentStudentId()
  const [threadId, setThreadId] = useState<string | null>(null)
  const [facts, setFacts] = useState<Fact[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [agent, setAgent] = useState("checking")
  const [opportunities, setOpportunities] = useState<OpportunitySummary | null>(null)
  const [roadmapTitle, setRoadmapTitle] = useState("")
  const [currentTopic, setCurrentTopic] = useState<{ title: string; status: string } | null>(null)
  // One-shot handoff from another tab (e.g. Projects "Refine with Hermes").
  // The draft prefills the composer once, then the parent clears it so
  // navigating away and back does not restore the same prompt.
  useEffect(() => {
    if (initialDraft) onConsumeDraft?.()
  }, [initialDraft, onConsumeDraft])
  const markedSeen = useRef(new Set<string>())
  const reduce = useReducedMotion()
  // Intro veil on the first Coach visit per session (or every visit when
  // the student opts in below) — rise-and-dissolve, sped up 1.6x:
  // loading (0.55s) -> leave (0.65s) -> done.
  const [introEveryVisit, setIntroEveryVisit] = useState(readIntroEveryVisit)
  // The coach is mounted hidden at startup: only start the veil once it is actually shown,
  // otherwise it plays unseen and the first real visit never gets it.
  const [portal, setPortal] = useState<PortalPhase | "done">(() => (!visible || reduce || (portalPlayed && !readIntroEveryVisit()) ? "done" : "loading"))
  const dismissPortal = useCallback(() => {
    portalPlayed = true
    setPortal("done")
  }, [])
  const firstShown = useRef(visible)
  useEffect(() => {
    if (visible && !firstShown.current) {
      firstShown.current = true
      if (!reduce && !portalPlayed) setPortal("loading")
    }
  }, [visible, reduce])
  useEffect(() => {
    if (reduce || portal === "done") return
    const timer = window.setTimeout(() => {
      if (portal === "leave") {
        portalPlayed = true
        setPortal("done")
      } else {
        setPortal("leave")
      }
    }, portal === "loading" ? 550 : 650)
    return () => window.clearTimeout(timer)
  }, [portal, reduce])
  // Hold the chat entrance while the veil covers it, so the handoff is a
  // crossfade instead of a pop: the shell rises in as the veil dissolves.
  // Marked entered once the veil starts leaving, so later replays never
  // hide the already-visible chat.
  const enteredRef = useRef(portal === "done")
  useEffect(() => {
    if (portal !== "loading") enteredRef.current = true
  }, [portal])
  const holdEntrance = !reduce && !enteredRef.current && portal === "loading"
  // The intro advertises "press Esc to skip" — wire it while the overlay is
  // up so keyboard users are never stuck behind it.
  useEffect(() => {
    // Only while the coach is on screen: other tabs keep their own Escape.
    if (portal === "done" || !visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissPortal()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [portal, dismissPortal, visible])
  const toggleIntroEveryVisit = useCallback((value: boolean) => {
    setIntroEveryVisit(value)
    try {
      if (value) window.localStorage.setItem(INTRO_EVERY_VISIT_KEY, "1")
      else window.localStorage.removeItem(INTRO_EVERY_VISIT_KEY)
    } catch {
      // Storage blocked: the choice lasts for this page load only.
    }
  }, [])
  const replayIntro = useCallback(() => {
    if (reduce) return
    setPortal("loading")
  }, [reduce])
  const pendingProposals = useMemo(() => proposals.filter((proposal) => proposal.status === "pending"), [proposals])
  const recentDecisions = useMemo(() => proposals.filter((proposal) => proposal.status !== "pending").slice(0, 3), [proposals])

  // Suggestion chips composed from live backend state — used only when Hermes
  // attached no follow-ups of its own. Labels stay short so they fit the pills.
  const fallbackPrompts = useMemo<SuggestedPrompt[]>(() => {
    const prompts: SuggestedPrompt[] = []
    if (pendingProposals.length) {
      prompts.push({
        label: t("coach.prompts.reviewDraft"),
        message: t("coach.prompts.reviewDraftMessage"),
      })
    }
    if (currentTopic) {
      prompts.push({
        label: t("coach.prompts.breakDown"),
        message: t("coach.prompts.breakDownMessage", { title: currentTopic.title }),
      })
    }
    const focus = [...facts].reverse().find((fact) => fact.category === "weakness")
      ?? [...facts].reverse().find((fact) => fact.category === "goal")
    if (focus) {
      prompts.push(focus.category === "weakness"
        ? { label: t("coach.prompts.practice", { key: focus.key }), message: t("coach.prompts.practiceMessage", { key: focus.key }) }
        : { label: t("coach.prompts.goal"), message: t("coach.prompts.goalMessage", { key: focus.key }) })
    }
    return prompts.slice(0, 3)
  }, [pendingProposals, currentTopic, facts, t])

  const refreshSide = useCallback(async () => {
    // Each panel updates on its own: one failing request (health flapping, opportunities
    // cache down) must not blank facts and proposals too.
    const [context, nextProposals, health, opportunitySummary, roadmapResult] = await Promise.allSettled([
      api<{ facts: Fact[] }>(`/api/students/${studentId}/context`),
      api<Proposal[]>(`/api/students/${studentId}/roadmap/proposals`),
      api<{ agent: string }>("/api/health"),
      api<OpportunitySummary>(`/api/students/${studentId}/opportunities/summary`),
      api<RoadmapResponse>(`/api/students/${studentId}/roadmap`),
    ])
    if (context.status === "fulfilled") setFacts(context.value.facts)
    if (nextProposals.status === "fulfilled") setProposals(nextProposals.value.filter((proposal) => proposal.kind !== "initial"))
    setAgent(health.status === "fulfilled" ? health.value.agent : "unavailable")
    if (opportunitySummary.status === "fulfilled") setOpportunities(opportunitySummary.value)
    const roadmap = roadmapResult.status === "fulfilled" ? roadmapResult.value : null
    if (roadmap) {
      setRoadmapTitle(roadmap.snapshot.title || "")
      const nodes = roadmap.snapshot.nodes ?? []
      const done = new Set(nodes.filter((node) => (node.status ?? "not-started") === "done").map((node) => node.id))
      const current = nodes.find((node) => (node.status ?? "not-started") === "in-progress")
        ?? nodes.find((node) => (node.status ?? "not-started") === "not-started" && (node.deps ?? []).every((dep) => done.has(dep)))
        ?? nodes.find((node) => (node.status ?? "not-started") !== "done")
        ?? null
      setCurrentTopic(current ? { title: current.title, status: current.status ?? "not-started" } : null)
    } else {
      setRoadmapTitle("")
      setCurrentTopic(null)
    }
  }, [studentId])

  const onRunFinished = useCallback(() => { refreshSide().catch(() => undefined) }, [refreshSide])
  const chat = useHermesChat(threadId, onRunFinished)
  const { setError } = chat
  const refreshChat = chat.refresh
  // Mounted once and hidden on other tabs: refresh the thread and side
  // panel when the coach becomes visible again, and replay the intro veil
  // for students who opted into it every visit.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) {
      refreshChat().catch(() => undefined)
      refreshSide().catch(() => undefined)
      if (introEveryVisit && !reduce) setPortal("loading")
    }
    wasVisible.current = visible
  }, [visible, refreshChat, refreshSide, introEveryVisit, reduce])

  useEffect(() => {
    api<StudentProfile>(`/api/students/${studentId}/profile`)
      .then((profile) => setThreadId(profile.thread_id))
      .then(refreshSide)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "coach.errors.unreachable"))
  }, [studentId, refreshSide, setError])

  useEffect(() => {
    const ids = chat.messages.flatMap((message) => message.role === "assistant"
      ? (message.metadata?.choice_group?.options ?? []).map((option) => option.opportunity?.id).filter((id): id is string => Boolean(id))
      : [])
    const unseen = [...new Set(ids)].filter((id) => !markedSeen.current.has(id))
    if (!unseen.length) return
    unseen.forEach((id) => markedSeen.current.add(id))
    // The endpoint takes at most 20 ids per call (schemas.OpportunityIds).
    const batches: string[][] = []
    for (let start = 0; start < unseen.length; start += 20) batches.push(unseen.slice(start, start + 20))
    Promise.all(batches.map((ids) => api<{ updated: number }>(`/api/students/${studentId}/opportunities/mark-seen`, { method: "POST", body: JSON.stringify({ ids }) })))
      .then(() => refreshSide())
      .catch(() => unseen.forEach((id) => markedSeen.current.delete(id)))
  }, [chat.messages, studentId, refreshSide])

  const [deciding, setDeciding] = useState<string | null>(null)
  const decide = async (proposal: Proposal, decision: "accept" | "reject") => {
    if (deciding) return  // a double click must not send a second decision (409 banner)
    setDeciding(proposal.id)
    chat.setError(null)
    try {
      await api(`/api/roadmap-proposals/${proposal.id}/${decision}`, { method: "POST" })
      if (decision === "accept") notifyRoadmapChanged()
      await refreshSide()
    } catch (reason) {
      chat.setError(reason instanceof Error ? reason.message : "coach.errors.proposalFailed")
    } finally {
      setDeciding(null)
    }
  }

  const retryAll = () => {
    chat.retry().catch(() => undefined)
    refreshSide().catch(() => undefined)
  }

  // Health probe (2s timeout) can flap while the chat path itself works, so a
  // momentary "unavailable" must not present as a terminal red state.
  const agentLabel = t(agent === "ready" ? "coach.agent.ready" : agent === "degraded" ? "coach.agent.degraded" : agent === "unavailable" ? "coach.agent.reconnecting" : "coach.agent.checking")
  const agentTone = agent === "ready" ? "success" : "warning"
  const agentTitle = t(agent === "unavailable"
    ? "coach.agent.titleUnavailable"
    : agent === "degraded"
      ? "coach.agent.titleDegraded"
      : "coach.agent.titleDefault")
  const subtitle = roadmapTitle ? t("coach.subtitleGoal", { title: roadmapTitle }) : t("coach.subtitleDefault")

  const recentDecision = recentDecisions[0] ?? null
  const recentDecisionTime = parseServerTime(recentDecision?.created_at)
  const recentDecisionAgo = recentDecisionTime !== null ? fmt.relative(Math.min(recentDecisionTime, Date.now())) : null
  const factParts = factCounts(facts)
  const latestFact = facts[facts.length - 1] ?? null

  return (
    <div className="fq fq-coach-page relative">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={holdEntrance ? { opacity: 0, y: 14 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: EASE_OUT }}
        className="chat-shell"
        style={{ "--fq-i": 0 } as CSSProperties}
      >
        {/* Chat column — the 10-coach concept: header, messages, composer */}
        <section className="chat-main" aria-label={t("coach.conversationLabel")}>
          <header className="chat-header">
            <div style={{ minWidth: 0 }}>
              <h1>{t("coach.title")}</h1>
              <p dir="auto">{subtitle}</p>
            </div>
            <div className="header-pills">
              {opportunities?.unseen_count ? (
                <button
                  type="button"
                  disabled={chat.busy || !threadId}
                  onClick={() => void chat.send(t("coach.newMatchesPrompt"))}
                  className="status warning"
                  style={{ border: 0, cursor: "pointer" }}
                >
                  <Trophy size={12} />{t("coach.newMatches", { count: fmt.number(opportunities.unseen_count) })}
                </button>
              ) : null}
              <span className={`status ${agentTone}`} title={agentTitle}>
                <span className={`status-dot${agent === "checking" || agent === "unavailable" ? " pulse" : ""}`} aria-hidden="true" />
                {agentLabel}
              </span>
            </div>
          </header>
          <ChatThreadView
            messages={chat.messages}
            busy={chat.busy}
            stage={chat.stage}
            error={chat.error}
            onSend={(text) => void chat.send(text)}
            onInteraction={(interaction, displayText) => void chat.sendInteraction(interaction, displayText)}
            onRetry={retryAll}
            onEditResend={(messageId, text) => void chat.editAndResend(messageId, text)}
            onStop={() => void chat.stop()}
            placeholder={t("coach.placeholder")}
            disabled={!threadId}
            draft={initialDraft}
            fallbackPrompts={fallbackPrompts}
            afterMessages={
              pendingProposals.length ? (
                <AnimatePresence initial={false}>
                  {pendingProposals.map((proposal) => (
                    <motion.article
                      key={proposal.id}
                      layout={reduce ? undefined : "position"}
                      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.3, ease: EASE_OUT }}
                      className="message assistant"
                      aria-label={t("coach.proposal.ariaLabel", { summary: proposal.summary })}
                    >
                      <p className="message-meta">{t("coach.proposal.meta")}</p>
                      <div className="proposal-card">
                        <h2 dir="auto">{proposal.summary}</h2>
                        <p>{t("coach.proposal.safety")}</p>
                        {proposal.reasoning ? <p dir="auto">{proposal.reasoning}</p> : null}
                        {proposal.operations.slice(0, 4).map((operation, index) => {
                          const meta = opMeta(operation.type)
                          return (
                            <div className="change-row" key={`${operation.node_id}-${index}`}>
                              <span aria-hidden="true">{meta.symbol}</span>
                              <span><strong>{t(meta.label)}</strong><span className="change-sub" dir="auto">{opDetail(operation)}</span></span>
                            </div>
                          )
                        })}
                        {proposal.operations.length > 4 ? <p>{t("coach.proposal.more", { count: proposal.operations.length - 4 })}</p> : null}
                        <div className="button-row" style={{ marginTop: 14 }}>
                          <button type="button" disabled={deciding !== null} onClick={() => void decide(proposal, "reject")} className="button secondary small">{t("coach.proposal.notNow")}</button>
                          <button type="button" disabled={deciding !== null} onClick={() => void decide(proposal, "accept")} className="button small">
                            {t("coach.proposal.accept", { count: proposal.operations.length })}
                          </button>
                        </div>
                      </div>
                    </motion.article>
                  ))}
                </AnimatePresence>
              ) : undefined
            }
            empty={
              <div>
                <span className="empty-mark"><Sparkles size={20} /></span>
                <h2>{t("coach.empty.title")}</h2>
                <p>{t("coach.empty.body")}</p>
              </div>
            }
          />
        </section>

        {/* Context panel — every row is live backend state */}
        <aside className="context-panel" aria-label={t("coach.context.ariaLabel")}>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={holdEntrance ? { opacity: 0, y: 10 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12, ease: EASE_OUT }}
          >
            <div className="context-section">
              <h2>{t("coach.context.title")}</h2>
              <p>{t("coach.context.subtitle")}</p>
              <div className="context-item">
                <strong>{t("coach.context.currentTopic")}</strong>
                <span>{currentTopic ? <><bdi>{currentTopic.title}</bdi>{" · "}{TOPIC_STATUS_KEYS[currentTopic.status] ? t(TOPIC_STATUS_KEYS[currentTopic.status]) : <bdi>{humanizeId(currentTopic.status)}</bdi>}</> : t("coach.context.noRoadmap")}</span>
              </div>
              <div className="context-item">
                <strong>{t("coach.context.confirmed", { count: facts.length })}</strong>
                <span dir="auto">{factParts.length ? fmt.list(factParts.map(([category, count]) => `${fmt.number(count)} ${category}`)) : t("coach.context.nothingConfirmed")}</span>
              </div>
              {pendingProposals.length ? (
                <div className="context-item">
                  <strong>{t("coach.context.drafts", { count: pendingProposals.length })}</strong>
                  <span>{t("coach.context.draftsNote")}</span>
                </div>
              ) : null}
            </div>

            <div className="context-section">
              <h2>{t("coach.context.recentDecision")}</h2>
              {recentDecision ? (
                <div className="context-item">
                  <strong>
                    <span className={`decision-dot${recentDecision.status === "rejected" ? " rejected" : ""}`} aria-hidden="true" />
                    <bdi>{recentDecision.summary}</bdi>
                  </strong>
                  <span>{recentDecision.status === "accepted" ? t("coach.context.accepted") : t("coach.context.passed")}{recentDecisionAgo ? ` · ${recentDecisionAgo}` : ""}</span>
                </div>
              ) : latestFact ? (
                <div className="context-item">
                  <strong dir="auto">{latestFact.key}</strong>
                  <span className="change-sub" dir="auto">{formatFactValue(latestFact.value)}</span>
                  <span>{t("coach.context.statedByYou")}</span>
                </div>
              ) : (
                <div className="context-item">
                  <strong>{t("coach.context.noDecisions")}</strong>
                  <span>{t("coach.context.noDecisionsNote")}</span>
                </div>
              )}
            </div>

            {facts.length ? (
              <div className="context-section">
                <h2>{t("coach.context.knows")}</h2>
                <p>{t("coach.context.knowsNote")}</p>
                {facts.slice(-3).reverse().map((fact) => (
                  <div className="context-item" key={fact.id}>
                    <strong dir="auto">{fact.key}</strong>
                    <span dir="auto">{formatFactValue(fact.value)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="context-section">
              <h2>{t("coach.context.tools")}</h2>
              <div className="context-tools">
                <label className="toggle-row" title={t("coach.context.introEveryVisitTitle")}>
                  <input
                    type="checkbox"
                    checked={introEveryVisit}
                    onChange={(event) => toggleIntroEveryVisit(event.target.checked)}
                  />
                  <span>{t("coach.context.introEveryVisit")}</span>
                </label>
                <button type="button" onClick={replayIntro} disabled={reduce || portal !== "done"} className="button secondary small wide">
                  <RotateCcw size={14} />{t("coach.context.replayIntro")}
                </button>
              </div>
            </div>
          </motion.div>
        </aside>
      </motion.div>

      <AnimatePresence>
        {portal !== "done" ? (
          <CoachPortalIntro phase={portal} speed={1.6} onSkip={dismissPortal} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}
