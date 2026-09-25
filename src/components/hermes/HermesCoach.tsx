"use client"

import { useCallback, useEffect, useState } from "react"
import { Bot, Brain, Check, GitBranch, Sparkles, X } from "lucide-react"
import { ChatThreadView } from "@/components/hermes/ChatThreadView"
import { useHermesChat } from "@/components/hermes/use-hermes-chat"
import { api, getCurrentStudentId, notifyRoadmapChanged, type StudentProfile } from "@/lib/farq-api"

interface Fact { id: string; category: string; key: string; value: unknown }
interface Proposal {
  id: string; summary: string; reasoning: string; status: "pending" | "accepted" | "rejected"; kind?: "ops" | "initial"
  operations: Array<{ type: string; node_id: string; changes?: Record<string, unknown> }>
}

const SUGGESTIONS = ["I prefer building real projects", "Show me research and industry branches", "I struggle with linear algebra"]

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
  const [draft, setDraft] = useState(initialDraft)

  const refreshSide = useCallback(async () => {
    const [context, nextProposals, health] = await Promise.all([
      api<{ facts: Fact[] }>(`/api/students/${studentId}/context`),
      api<Proposal[]>(`/api/students/${studentId}/roadmap/proposals`),
      api<{ agent: string }>("/api/health"),
    ])
    setFacts(context.facts); setProposals(nextProposals.filter((proposal) => proposal.kind !== "initial")); setAgent(health.agent)
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

  const decide = async (proposal: Proposal, decision: "accept" | "reject") => {
    chat.setError(null)
    try {
      await api(`/api/roadmap-proposals/${proposal.id}/${decision}`, { method: "POST" })
      if (decision === "accept") notifyRoadmapChanged()
      await refreshSide()
    } catch (reason) { chat.setError(reason instanceof Error ? reason.message : "Could not update proposal") }
  }

  return (
    <div className="grid h-[calc(100dvh-4rem)] min-h-0 flex-none grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,1fr)] overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border">
        <div className="shrink-0 border-b border-border px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><Bot className="size-5" /></span><div><h1 className="font-semibold">Hermes Coach</h1><p className="text-xs text-muted-foreground">Learns from your words and the paths you choose</p></div></div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${agent === "ready" ? "bg-emerald-500/10 text-emerald-600" : agent === "unavailable" ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-700"}`}>{agent === "ready" ? "Agent online" : agent === "checking" ? "Checking agent" : agent === "degraded" ? "Agent degraded" : "Agent unavailable"}</span>
        </div></div>
        <ChatThreadView
          messages={chat.messages}
          busy={chat.busy}
          stage={chat.stage}
          error={chat.error}
          onSend={(text) => void chat.send(text)}
          onInteraction={(interaction, displayText) => void chat.sendInteraction(interaction, displayText)}
          onRetry={() => { chat.refresh().catch(() => undefined); refreshSide().catch(() => undefined) }}
          onEditResend={(messageId, text) => void chat.editAndResend(messageId, text)}
          placeholder="Tell Hermes about your goals or choose a suggested path…"
          disabled={!threadId}
          draft={draft}
          empty={<div className="rounded-3xl border border-dashed border-border p-8 text-center"><Sparkles className="mx-auto size-7 text-primary" /><h2 className="mt-3 font-semibold">Shape your roadmap through conversation</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Tell Hermes what you enjoy, what you struggle with, or ask it to show you two possible branches.</p><div className="mt-5 flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">{prompt}</button>)}</div></div>}
        />
      </section>
      <aside className="min-h-0 min-w-0 space-y-5 overflow-y-auto overscroll-contain border-t border-border p-4 sm:p-6 lg:border-t-0">
        <div><div className="flex items-center gap-2"><Brain className="size-4 text-primary" /><h2 className="text-sm font-semibold">What Hermes knows</h2></div><p className="mt-1 text-xs text-muted-foreground">Only explicit statements, choices, and evidence you confirmed are stored.</p><div className="mt-3 space-y-2">{facts.length === 0 ? <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">No preferences learned yet.</p> : facts.map((fact) => <div key={fact.id} className="rounded-xl border border-border bg-card p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{fact.category}</p><p className="mt-1 text-sm font-medium">{fact.key}</p><p className="line-clamp-3 text-xs text-muted-foreground">{formatFactValue(fact.value)}</p></div>)}</div></div>
        <div><div className="flex items-center gap-2"><GitBranch className="size-4 text-primary" /><h2 className="text-sm font-semibold">Roadmap proposals</h2></div><div className="mt-3 space-y-3">{proposals.length === 0 ? <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">Hermes has not proposed a revision.</p> : proposals.map((proposal) => <article key={proposal.id} className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{proposal.summary}</h3><span className="text-[10px] uppercase text-muted-foreground">{proposal.status}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{proposal.reasoning}</p><div className="mt-3 space-y-1">{proposal.operations.map((operation, index) => <p key={`${operation.node_id}-${index}`} className="text-[11px]"><span className="font-semibold">{operation.type.replaceAll("_", " ")}</span> · {operation.node_id}</p>)}</div>{proposal.status === "pending" ? <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => void decide(proposal, "reject")} className="flex items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium"><X className="size-3.5" />Reject</button><button onClick={() => void decide(proposal, "accept")} className="flex items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"><Check className="size-3.5" />Accept</button></div> : null}</article>)}</div></div>
      </aside>
    </div>
  )
}
