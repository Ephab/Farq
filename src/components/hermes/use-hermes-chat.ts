"use client"

import { useCallback, useEffect, useState } from "react"
import { API_BASE, api, hermesRequestParts } from "@/lib/farq-api"

export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; created_at: string }

/** Messages, sending, and live run status for one Hermes chat thread. */
export function useHermesChat(threadId: string | null, onRunFinished?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState("")
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!threadId) return
    setMessages(await api<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`))
  }, [threadId])

  useEffect(() => {
    refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not reach Farq API"))
  }, [refresh])

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || !threadId || busy) return
    setBusy(true); setError(null)
    setMessages((items) => [...items, { id: `optimistic-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() }])
    try {
      const { body, headers } = hermesRequestParts()
      // Tab-only Farq Hermes key override goes to Farq API only — never to
      // providers directly, never persisted, never sent to a system Hermes.
      const result = await api<{ run_id: string }>(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, ...body }),
        headers,
      })
      setStage("Starting Hermes")
      const source = new EventSource(`${API_BASE}/api/agent-runs/${result.run_id}/events`)
      source.addEventListener("status", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { status: string; stage: string; error?: string }
        setStage(payload.stage)
        if (["completed", "failed", "cancelled"].includes(payload.status)) {
          source.close(); setBusy(false); setStage("")
          if (payload.error) setError(payload.error)
          refresh().catch(() => undefined)
          onRunFinished?.()
        }
      })
      source.onerror = () => { source.close(); setBusy(false); setError("Lost the Hermes progress stream. Your message is saved; refresh to check it.") }
    } catch (reason) {
      setBusy(false); setError(reason instanceof Error ? reason.message : "Could not start Hermes")
      await refresh().catch(() => undefined)
    }
  }, [threadId, busy, refresh, onRunFinished])

  return { messages, busy, stage, error, setError, send, refresh }
}

const OPTIONS_LINE = /^\s*Options:\s*(.+)$/im

/** Split Hermes' `Options: A | B | C` convention into text and choices. */
export function splitOptions(content: string): { text: string; options: string[] } {
  const match = content.match(OPTIONS_LINE)
  if (!match) return { text: content, options: [] }
  const options = match[1].split("|").map((option) => option.trim().replace(/^[`*]+|[`*]+$/g, "")).filter(Boolean).slice(0, 6)
  return { text: content.replace(OPTIONS_LINE, "").trim(), options }
}
