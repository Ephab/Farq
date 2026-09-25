"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Brain, Check, GitBranch, RefreshCw, Sparkles, Trophy, X } from "lucide-react"
import { ChatThreadView } from "@/components/hermes/ChatThreadView"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { api, getCurrentStudentId, notifyRoadmapChanged, type OpportunitySummary, type StudentProfile } from "@/lib/farq-api"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

interface Fact { id: string; category: string; key: string; value: unknown }
interface Proposal {
  id: string; summary: string; reasoning: string; status: "pending" | "accepted" | "rejected"; kind?: "ops" | "initial"
  operations: Array<{ type: string; node_id: string; changes?: Record<string, unknown> }>
}

const SUGGESTIONS = ["I prefer building real projects", "Show me research and industry branches", "I struggle with linear algebra"]
const QUICK_PROMPTS = ["Research route", "Smaller first step"]

function formatFactValue(value: unknown): string {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : String(item)}`).join(" · ")
  }
  return String(value)
}

export function HermesCoach({ initialDraft = "" }: { initialDraft?: string }) {
  const studentId = getCurrentStudentId()
  const [threadId, setThreadId] = useState<string | null>(null)
  const [facts, setFacts] = useState<Fact[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [agent, setAgent] = useState("checking")
  const [opportunities, setOpportunities] = useState<OpportunitySummary | null>(null)
  const [draft, setDraft] = useState(initialDraft)
  const markedSeen = useRef(new Set<string>())
  const reduce = useReducedMotion()
  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending")
  const recentDecisions = proposals.filter((proposal) => proposal.status !== "pending").slice(0, 5)

  const refreshSide = useCallback(async () => {
    const [context, nextProposals, health, opportunitySummary] = await Promise.all([
      api<{ facts: Fact[] }>(`/api/students/${studentId}/context`),
      api<Proposal[]>(`/api/students/${studentId}/roadmap/proposals`),
      api<{ agent: string }>("/api/health"),
      api<OpportunitySummary>(`/api/students/${studentId}/opportunities/summary`),
    ])
    setFacts(context.facts); setProposals(nextProposals.filter((proposal) => proposal.kind !== "initial")); setAgent(health.agent); setOpportunities(opportunitySummary)
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
  const agentTone = agent === "ready"
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : agent === "unavailable"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-y-auto bg-muted/30 lg:overflow-hidden">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.52, ease: EASE_OUT }}
        className="grid min-h-full w-full flex-1 grid-rows-[minmax(0,1fr)_auto] lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_330px] lg:grid-rows-1 lg:overflow-hidden"
      >
        {/* Chat column — mirrors the 10-coach concept: header, messages, composer */}
        <section className="flex min-h-[72dvh] min-w-0 flex-col lg:h-full lg:min-h-0">
          <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-border px-4 py-3.5 sm:px-7">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight">Hermes Coach</h1>
              <p className="truncate text-[13px] text-muted-foreground">Goal · learns from your words and the paths you choose</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {opportunities?.unseen_count ? (
                <motion.button
                  type="button"
                  disabled={chat.busy}
                  onClick={() => void chat.send("Show me my new Saudi hackathon matches from Hackathonat.")}
                  whileTap={reduce ? undefined : { scale: 0.96 }}
                  className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 outline-none hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:text-amber-400"
                >
                  <Trophy className="size-3" />{opportunities.unseen_count} new
                </motion.button>
              ) : null}
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold", agentTone)}>
                <span className={cn("size-1.5 rounded-full", agent === "ready" ? "bg-emerald-500" : agent === "unavailable" ? "bg-red-500" : "bg-amber-500", agent === "checking" && !reduce ? "animate-pulse" : "")} />
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
            quickPrompts={QUICK_PROMPTS}
            empty={
              <div className="rounded-3xl border border-dashed border-border bg-background p-8 text-center shadow-sm">
                <Sparkles className="mx-auto size-7 text-primary" />
                <h2 className="mt-3 text-lg font-semibold tracking-tight">Shape your roadmap through conversation</h2>
                <p className="mx-auto mt-2 max-w-md text-[15px] text-muted-foreground">Tell Hermes what you enjoy, what you struggle with, or ask it to compare the research and industry routes.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => setDraft(prompt)} className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-[13px] font-medium outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        </section>

        {/* Context panel — plan context, knowledge, proposals, tools */}
        <aside className="min-w-0 border-t border-border bg-background p-5 sm:p-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease: EASE_OUT }}
            className="space-y-6"
          >
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Plan context</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">Visible sources for this conversation.</p>
              <div className="mt-3 grid gap-2">
                <div className="grid gap-1 rounded-2xl border border-border bg-background p-3 shadow-sm">
                  <strong className="text-sm font-semibold">{facts.length} confirmed records</strong>
                  <span className="text-[13px] text-muted-foreground">Degree, courses, and projects you reviewed</span>
                </div>
                <div className="grid gap-1 rounded-2xl border border-border bg-background p-3 shadow-sm">
                  <strong className="text-sm font-semibold">{pendingProposals.length} awaiting decision</strong>
                  <span className="text-[13px] text-muted-foreground">Completed and in-progress topics stay unchanged</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2"><Brain className="size-4 text-primary" /><h2 className="text-[15px] font-semibold tracking-tight">What Hermes knows</h2></div>
              <p className="mt-1 text-[13px] text-muted-foreground">Only explicit statements, choices, and evidence you confirmed are stored.</p>
              <div className="mt-3 space-y-2">
                {facts.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border bg-background p-3 text-[13px] text-muted-foreground">No preferences learned yet.</p>
                ) : (
                  <AnimatePresence initial={false}>
                    {facts.map((fact, index) => (
                      <motion.div
                        key={fact.id}
                        layout={reduce ? undefined : "position"}
                        initial={reduce ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.2), ease: EASE_OUT }}
                        className="grid gap-1 rounded-2xl border border-border bg-background p-3 shadow-sm"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{fact.category}</p>
                        <p className="text-[15px] font-medium">{fact.key}</p>
                        <p className="line-clamp-3 text-[13px] text-muted-foreground">{formatFactValue(fact.value)}</p>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2"><GitBranch className="size-4 text-primary" /><h2 className="text-[15px] font-semibold tracking-tight">Roadmap proposals</h2></div>
              <div className="mt-3 space-y-3">
                {pendingProposals.length === 0 && recentDecisions.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border bg-background p-3 text-[13px] text-muted-foreground">Hermes has not proposed a revision.</p>
                ) : null}
                {pendingProposals.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Needs your decision</p>
                    <AnimatePresence initial={false}>
                      {pendingProposals.map((proposal) => (
                        <motion.article
                          key={proposal.id}
                          layout={reduce ? undefined : "position"}
                          initial={reduce ? false : { opacity: 0, y: 12, scale: 0.99 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.3, ease: EASE_OUT }}
                          className="rounded-2xl border border-primary/25 bg-background p-4 shadow-sm"
                        >
                          <h3 className="text-[15px] font-semibold tracking-tight">{proposal.summary}</h3>
                          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{proposal.reasoning}</p>
                          <div className="mt-3 space-y-1 border-t border-border pt-2">
                            {proposal.operations.map((operation, index) => (
                              <p key={`${operation.node_id}-${index}`} className="text-xs text-muted-foreground">
                                <span className="font-semibold text-foreground">{operation.type.replaceAll("_", " ")}</span> · {operation.node_id}
                              </p>
                            ))}
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <motion.button whileTap={reduce ? undefined : { scale: 0.97 }} onClick={() => void decide(proposal, "reject")} className="flex items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" />Not now</motion.button>
                            <motion.button whileTap={reduce ? undefined : { scale: 0.97 }} onClick={() => void decide(proposal, "accept")} className="flex items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><Check className="size-3.5" />Accept</motion.button>
                          </div>
                        </motion.article>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : null}
                {recentDecisions.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent decisions</p>
                    {recentDecisions.map((proposal) => (
                      <article key={proposal.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 shadow-sm">
                        <span className={cn("size-1.5 shrink-0 rounded-full", proposal.status === "accepted" ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                        <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={proposal.summary}>{proposal.summary}</p>
                        <span className={cn("shrink-0 text-[10px] font-semibold uppercase tracking-wide", proposal.status === "accepted" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{proposal.status}</span>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Conversation tools</h2>
              <div className="mt-3 grid gap-2">
                <motion.button
                  type="button"
                  onClick={retryAll}
                  whileTap={reduce ? undefined : { scale: 0.99 }}
                  className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] font-medium shadow-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className="size-3.5" />Sync conversation
                </motion.button>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.slice(0, 2).map((prompt) => (
                    <button key={prompt} type="button" onClick={() => setDraft(prompt)} className="flex-1 whitespace-nowrap rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {prompt.length > 26 ? `${prompt.slice(0, 26)}…` : prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </aside>
      </motion.div>
    </div>
  )
}
