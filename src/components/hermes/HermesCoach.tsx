"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { RefreshCw, Sparkles, Trophy } from "lucide-react"
import { ChatThreadView, type SuggestedPrompt } from "@/components/hermes/ChatThreadView"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { api, getCurrentStudentId, notifyRoadmapChanged, type OpportunitySummary, type StudentProfile } from "@/lib/farq-api"
import { EASE_OUT } from "@/lib/ease"
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

function opMeta(type: string): { symbol: string; label: string } {
  switch (type) {
    case "add_node": return { symbol: "+", label: "New step" }
    case "remove_node": return { symbol: "−", label: "Removed step" }
    case "move_node": return { symbol: "→", label: "Reordered step" }
    case "set_dependencies": return { symbol: "→", label: "New prerequisite" }
    default: return { symbol: "↺", label: "Updated step" }
  }
}

function opDetail(operation: ProposalOperation): string {
  const changes = operation.changes ?? {}
  const title = typeof changes.title === "string" && changes.title.trim() ? changes.title.trim() : null
  if (title) return title
  return humanizeId(operation.node_id)
}

function timeAgo(iso: string | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

function factsSummary(facts: Fact[]): string {
  if (facts.length === 0) return "Nothing confirmed yet"
  const counts = new Map<string, number>()
  for (const fact of facts) counts.set(fact.category, (counts.get(fact.category) ?? 0) + 1)
  const parts = [...counts.entries()].map(([category, count]) => `${count} ${category}${count === 1 ? "" : "s"}`)
  return parts.slice(0, 3).join(", ")
}

export function HermesCoach({ initialDraft = "" }: { initialDraft?: string }) {
  const studentId = getCurrentStudentId()
  const [threadId, setThreadId] = useState<string | null>(null)
  const [facts, setFacts] = useState<Fact[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [agent, setAgent] = useState("checking")
  const [opportunities, setOpportunities] = useState<OpportunitySummary | null>(null)
  const [roadmapTitle, setRoadmapTitle] = useState("")
  const [currentTopic, setCurrentTopic] = useState<{ title: string; status: string } | null>(null)
  // Prefill handed over from another tab (e.g. My data "Ask Hermes").
  const [draft] = useState(initialDraft)
  const markedSeen = useRef(new Set<string>())
  const reduce = useReducedMotion()
  const pendingProposals = useMemo(() => proposals.filter((proposal) => proposal.status === "pending"), [proposals])
  const recentDecisions = useMemo(() => proposals.filter((proposal) => proposal.status !== "pending").slice(0, 3), [proposals])

  // Suggestion chips composed from live backend state — used only when Hermes
  // attached no follow-ups of its own. Labels stay short so they fit the pills.
  const fallbackPrompts = useMemo<SuggestedPrompt[]>(() => {
    const prompts: SuggestedPrompt[] = []
    if (pendingProposals.length) {
      prompts.push({
        label: "Review my roadmap draft",
        message: "Summarize my pending roadmap draft in plain language and recommend whether I should accept it.",
      })
    }
    if (currentTopic) {
      prompts.push({
        label: "Break down my current topic",
        message: `Help me break "${currentTopic.title}" into a smaller first step I can finish today.`,
      })
    }
    const focus = [...facts].reverse().find((fact) => fact.category === "weakness")
      ?? [...facts].reverse().find((fact) => fact.category === "goal")
    if (focus) {
      prompts.push(focus.category === "weakness"
        ? { label: `Practice ${focus.key}`, message: `Give me a focused practice plan for "${focus.key}".` }
        : { label: "Move toward my goal", message: `What should I do next to make progress on "${focus.key}"?` })
    }
    return prompts.slice(0, 3)
  }, [pendingProposals, currentTopic, facts])

  const refreshSide = useCallback(async () => {
    const [context, nextProposals, health, opportunitySummary, roadmap] = await Promise.all([
      api<{ facts: Fact[] }>(`/api/students/${studentId}/context`),
      api<Proposal[]>(`/api/students/${studentId}/roadmap/proposals`),
      api<{ agent: string }>("/api/health"),
      api<OpportunitySummary>(`/api/students/${studentId}/opportunities/summary`),
      api<RoadmapResponse>(`/api/students/${studentId}/roadmap`).catch(() => null),
    ])
    setFacts(context.facts)
    setProposals(nextProposals.filter((proposal) => proposal.kind !== "initial"))
    setAgent(health.agent)
    setOpportunities(opportunitySummary)
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

  useEffect(() => {
    api<StudentProfile>(`/api/students/${studentId}/profile`)
      .then((profile) => setThreadId(profile.thread_id))
      .then(refreshSide)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not reach Farq API"))
  }, [studentId, refreshSide, setError])

  useEffect(() => {
    const ids = chat.messages.flatMap((message) => message.role === "assistant"
      ? (message.metadata?.choice_group?.options ?? []).map((option) => option.opportunity?.id).filter((id): id is string => Boolean(id))
      : [])
    const unseen = [...new Set(ids)].filter((id) => !markedSeen.current.has(id))
    if (!unseen.length) return
    unseen.forEach((id) => markedSeen.current.add(id))
    api<{ updated: number }>(`/api/students/${studentId}/opportunities/mark-seen`, { method: "POST", body: JSON.stringify({ ids: unseen }) })
      .then(() => refreshSide())
      .catch(() => unseen.forEach((id) => markedSeen.current.delete(id)))
  }, [chat.messages, studentId, refreshSide])

  const decide = async (proposal: Proposal, decision: "accept" | "reject") => {
    chat.setError(null)
    try {
      await api(`/api/roadmap-proposals/${proposal.id}/${decision}`, { method: "POST" })
      if (decision === "accept") notifyRoadmapChanged()
      await refreshSide()
    } catch (reason) { chat.setError(reason instanceof Error ? reason.message : "Could not update proposal") }
  }

  const retryAll = () => {
    chat.refresh().catch(() => undefined)
    refreshSide().catch(() => undefined)
  }

  const agentLabel = agent === "ready" ? "Ready" : agent === "checking" ? "Checking" : agent === "degraded" ? "Degraded" : "Unavailable"
  const agentTone = agent === "ready" ? "success" : agent === "unavailable" ? "danger" : "warning"
  const subtitle = roadmapTitle ? `Goal · ${roadmapTitle}` : "Goal · learns from your words and the paths you choose"

  const recentDecision = recentDecisions[0] ?? null
  const recentDecisionAgo = timeAgo(recentDecision?.created_at)
  const latestFact = facts[facts.length - 1] ?? null

  return (
    <div className="fq fq-coach-page">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.52, ease: EASE_OUT }}
        className="chat-shell reveal"
        style={{ "--fq-i": 0 } as CSSProperties}
      >
        {/* Chat column — the 10-coach concept: header, messages, composer */}
        <section className="chat-main" aria-label="Hermes Coach conversation">
          <header className="chat-header">
            <div style={{ minWidth: 0 }}>
              <h1>Hermes Coach</h1>
              <p>{subtitle}</p>
            </div>
            <div className="header-pills">
              {opportunities?.unseen_count ? (
                <button
                  type="button"
                  disabled={chat.busy || !threadId}
                  onClick={() => void chat.send("Show me my new Saudi hackathon matches from Hackathonat.")}
                  className="status warning"
                  style={{ border: 0, cursor: "pointer" }}
                >
                  <Trophy size={12} />{opportunities.unseen_count} new
                </button>
              ) : null}
              <span className={`status ${agentTone}`}>
                <span className={`status-dot${agent === "checking" ? " pulse" : ""}`} aria-hidden="true" />
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
            placeholder="Ask about goals, tradeoffs, or what to do next…"
            disabled={!threadId}
            draft={draft}
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
                      aria-label={`Roadmap draft: ${proposal.summary}`}
                    >
                      <p className="message-meta">Roadmap draft</p>
                      <div className="proposal-card">
                        <h2>{proposal.summary}</h2>
                        <p>This changes future work only. Completed and in-progress topics stay unchanged.</p>
                        {proposal.reasoning ? <p>{proposal.reasoning}</p> : null}
                        {proposal.operations.slice(0, 4).map((operation, index) => {
                          const meta = opMeta(operation.type)
                          return (
                            <div className="change-row" key={`${operation.node_id}-${index}`}>
                              <span aria-hidden="true">{meta.symbol}</span>
                              <span><strong>{meta.label}</strong><span className="change-sub">{opDetail(operation)}</span></span>
                            </div>
                          )
                        })}
                        {proposal.operations.length > 4 ? <p>+{proposal.operations.length - 4} more changes</p> : null}
                        <div className="button-row" style={{ marginTop: 14 }}>
                          <button type="button" onClick={() => void decide(proposal, "reject")} className="button secondary small">Not now</button>
                          <button type="button" onClick={() => void decide(proposal, "accept")} className="button small">
                            Accept {proposal.operations.length} change{proposal.operations.length === 1 ? "" : "s"}
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
                <h2>Shape your roadmap through conversation</h2>
                <p>Tell Hermes what you enjoy, what you struggle with, or ask it to compare the research and industry routes. Its suggested next questions appear as pills above the composer.</p>
              </div>
            }
          />
        </section>

        {/* Context panel — every row is live backend state */}
        <aside className="context-panel" aria-label="Plan context">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease: EASE_OUT }}
          >
            <div className="context-section">
              <h2>Plan context</h2>
              <p>Visible sources for this conversation.</p>
              <div className="context-item">
                <strong>Current topic</strong>
                <span>{currentTopic ? `${currentTopic.title} · ${currentTopic.status === "in-progress" ? "in progress" : humanizeId(currentTopic.status)}` : "No active roadmap yet"}</span>
              </div>
              <div className="context-item">
                <strong>{facts.length} confirmed record{facts.length === 1 ? "" : "s"}</strong>
                <span>{factsSummary(facts)}</span>
              </div>
              {pendingProposals.length ? (
                <div className="context-item">
                  <strong>{pendingProposals.length} draft{pendingProposals.length === 1 ? "" : "s"} awaiting decision</strong>
                  <span>Completed and in-progress topics stay unchanged</span>
                </div>
              ) : null}
            </div>

            <div className="context-section">
              <h2>Recent decision</h2>
              {recentDecision ? (
                <div className="context-item">
                  <strong>
                    <span className={`decision-dot${recentDecision.status === "rejected" ? " rejected" : ""}`} aria-hidden="true" />
                    {recentDecision.summary}
                  </strong>
                  <span>{recentDecision.status === "accepted" ? "Accepted" : "Passed for now"}{recentDecisionAgo ? ` · ${recentDecisionAgo}` : ""}</span>
                </div>
              ) : latestFact ? (
                <div className="context-item">
                  <strong>{latestFact.key}</strong>
                  <span className="change-sub">{formatFactValue(latestFact.value)}</span>
                  <span>Stated by you</span>
                </div>
              ) : (
                <div className="context-item">
                  <strong>No decisions yet</strong>
                  <span>Choices you make and drafts you accept appear here</span>
                </div>
              )}
            </div>

            {facts.length ? (
              <div className="context-section">
                <h2>What Hermes knows</h2>
                <p>Only explicit statements, choices, and evidence you confirmed.</p>
                {facts.slice(-3).reverse().map((fact) => (
                  <div className="context-item" key={fact.id}>
                    <strong>{fact.key}</strong>
                    <span>{formatFactValue(fact.value)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="context-section">
              <h2>Conversation tools</h2>
              <div className="context-tools">
                <button type="button" onClick={retryAll} className="button secondary small wide">
                  <RefreshCw size={14} />Sync conversation
                </button>
              </div>
            </div>
          </motion.div>
        </aside>
      </motion.div>
    </div>
  )
}
