"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, Brain, Check, GitBranch, LoaderCircle, RefreshCw, Send, Sparkles, X } from "lucide-react"
import { API_BASE, api } from "@/lib/farq-api"

interface Message { id: string; role: "user" | "assistant"; content: string; created_at: string }
interface Fact { id: string; category: string; key: string; value: unknown }
interface Proposal {
  id: string; summary: string; reasoning: string; status: "pending" | "accepted" | "rejected"
  operations: Array<{ type: string; node_id: string; changes?: Record<string, unknown> }>
}
interface Demo { student_id: string; thread_id: string }

export function HermesCoach() {
  const [demo, setDemo] = useState<Demo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [facts, setFacts] = useState<Fact[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [agent, setAgent] = useState("checking")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (current?: Demo) => {
    const ids = current ?? demo ?? await api<Demo>("/api/demo")
    if (!demo) setDemo(ids)
    const [nextMessages, context, nextProposals, health] = await Promise.all([
      api<Message[]>(`/api/chat/threads/${ids.thread_id}/messages`),
      api<{ facts: Fact[] }>(`/api/students/${ids.student_id}/context`),
      api<Proposal[]>(`/api/students/${ids.student_id}/roadmap/proposals`),
      api<{ agent: string }>("/api/health"),
    ])
    setMessages(nextMessages); setFacts(context.facts); setProposals(nextProposals); setAgent(health.agent)
  }, [demo])

  useEffect(() => { refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not reach Farq API")) }, [refresh])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, stage])

  const submit = async () => {
    const content = input.trim()
    if (!content || !demo || busy) return
    setInput(""); setBusy(true); setError(null)
    setMessages((items) => [...items, { id: `optimistic-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() }])
    try {
      const result = await api<{ run_id: string }>(`/api/chat/threads/${demo.thread_id}/messages`, { method: "POST", body: JSON.stringify({ content }) })
      setStage("Starting Hermes")
      const source = new EventSource(`${API_BASE}/api/agent-runs/${result.run_id}/events`)
      source.addEventListener("status", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { status: string; stage: string; error?: string }
        setStage(payload.stage)
        if (["completed", "failed", "cancelled"].includes(payload.status)) {
          source.close(); setBusy(false); setStage("")
          if (payload.error) setError(payload.error)
          refresh(demo).catch(() => undefined)
        }
      })
      source.onerror = () => { source.close(); setBusy(false); setError("Lost the Hermes progress stream. Your message is saved; refresh to check it.") }
    } catch (reason) {
      setBusy(false); setError(reason instanceof Error ? reason.message : "Could not start Hermes"); await refresh(demo)
    }
  }

  const decide = async (proposal: Proposal, decision: "accept" | "reject") => {
    setError(null)
    try { await api(`/api/roadmap-proposals/${proposal.id}/${decision}`, { method: "POST" }); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update proposal") }
  }

  return (
    <div className="grid min-h-[calc(100svh-4rem)] grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-0 flex-col border-r border-border">
        <div className="border-b border-border px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><Bot className="size-5" /></span><div><h1 className="font-semibold">Hermes Coach</h1><p className="text-xs text-muted-foreground">Learns from your words and the paths you choose</p></div></div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${agent === "ready" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-700"}`}>{agent === "ready" ? "Agent online" : agent === "checking" ? "Checking agent" : "Agent unavailable"}</span>
        </div></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-3xl space-y-5">
          {messages.length === 0 ? <div className="rounded-3xl border border-dashed border-border p-8 text-center"><Sparkles className="mx-auto size-7 text-primary" /><h2 className="mt-3 font-semibold">Shape your roadmap through conversation</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Tell Hermes what you enjoy, what you struggle with, or ask it to show you two possible branches.</p><div className="mt-5 flex flex-wrap justify-center gap-2">{["I prefer building real projects", "Show me research and industry branches", "I struggle with linear algebra"].map((prompt) => <button key={prompt} type="button" onClick={() => setInput(prompt)} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">{prompt}</button>)}</div></div> : null}
          {messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[76%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-card"}`}><p className="whitespace-pre-wrap">{message.content}</p></div></div>)}
          {busy ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{stage || "Hermes is working"}</div> : null}
          {error ? <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span><button onClick={() => refresh()}><RefreshCw className="size-4" /></button></div> : null}<div ref={bottomRef} />
        </div></div>
        <div className="border-t border-border p-3 sm:p-5"><div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="Tell Hermes about your goals or choose a suggested path…" rows={2} className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" /><button type="button" disabled={!input.trim() || busy || !demo} onClick={() => void submit()} className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="size-4" /></button></div></div>
      </section>
      <aside className="space-y-5 overflow-y-auto p-4 sm:p-6">
        <div><div className="flex items-center gap-2"><Brain className="size-4 text-primary" /><h2 className="text-sm font-semibold">What Hermes knows</h2></div><p className="mt-1 text-xs text-muted-foreground">Only explicit statements and choices are stored.</p><div className="mt-3 space-y-2">{facts.length === 0 ? <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">No preferences learned yet.</p> : facts.map((fact) => <div key={fact.id} className="rounded-xl border border-border bg-card p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{fact.category}</p><p className="mt-1 text-sm font-medium">{fact.key}</p><p className="text-xs text-muted-foreground">{String(fact.value)}</p></div>)}</div></div>
        <div><div className="flex items-center gap-2"><GitBranch className="size-4 text-primary" /><h2 className="text-sm font-semibold">Roadmap proposals</h2></div><div className="mt-3 space-y-3">{proposals.length === 0 ? <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">Hermes has not proposed a revision.</p> : proposals.map((proposal) => <article key={proposal.id} className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{proposal.summary}</h3><span className="text-[10px] uppercase text-muted-foreground">{proposal.status}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{proposal.reasoning}</p><div className="mt-3 space-y-1">{proposal.operations.map((operation, index) => <p key={`${operation.node_id}-${index}`} className="text-[11px]"><span className="font-semibold">{operation.type.replaceAll("_", " ")}</span> · {operation.node_id}</p>)}</div>{proposal.status === "pending" ? <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => void decide(proposal, "reject")} className="flex items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium"><X className="size-3.5" />Reject</button><button onClick={() => void decide(proposal, "accept")} className="flex items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"><Check className="size-3.5" />Accept</button></div> : null}</article>)}</div></div>
      </aside>
    </div>
  )
}
