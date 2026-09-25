"use client"

import { useCallback, useEffect, useState } from "react"
import { API_BASE, api, hermesRequestParts } from "@/lib/farq-api"

export interface OpportunityCard {
  id: string
  external_id: string
  title: string
  organizer: string
  locations: string[]
  topics: string[]
  virtual: boolean
  source_date: string | null
  date_label: string | null
  detail_url: string
  registration_url: string
  source: string
  fetched_at: string
  score: number
  reasons: string[]
  status: "unseen" | "seen" | "dismissed" | "added"
}
export interface ChatChoiceOption { id: string; title: string; description: string; opportunity_id?: string | null; opportunity?: OpportunityCard | null }
export interface ChatChoiceGroup {
  mode: "single" | "multiple"
  prompt: string
  options: ChatChoiceOption[]
  min_selections: number
  max_selections: number
}
export interface ChatFollowUp { id: string; label: string; prompt: string }
export interface ChatInteractionMetadata {
  kind: "choice" | "follow_up"
  source_message_id: string
  selected_option_ids: string[]
}
export interface ChatMessageMetadata {
  choice_group?: ChatChoiceGroup | null
  follow_ups?: ChatFollowUp[]
  interaction?: ChatInteractionMetadata
}
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; metadata?: ChatMessageMetadata | null; created_at: string }
export interface ChatInteractionInput {
  kind: "choice" | "follow_up"
  source_message_id: string
  selected_option_ids: string[]
}

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

  const dispatch = useCallback(async (
    payload: { content?: string; interaction?: ChatInteractionInput },
    optimistic: Omit<ChatMessage, "id" | "role" | "created_at">,
  ) => {
    if (!threadId || busy) return
    setBusy(true); setError(null)
    setMessages((items) => [...items, { ...optimistic, id: `optimistic-${Date.now()}`, role: "user", created_at: new Date().toISOString() }])
    try {
      const { body, headers } = hermesRequestParts()
      // Tab-only Farq Hermes key override goes to Farq API only — never to
      // providers directly, never persisted, never sent to a system Hermes.
      const result = await api<{ run_id: string }>(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ ...payload, ...body }),
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

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content) return
    await dispatch({ content }, { content })
  }, [dispatch])

  const sendInteraction = useCallback(async (interaction: ChatInteractionInput, displayText: string) => {
    await dispatch(
      { interaction },
      { content: displayText, metadata: { interaction } },
    )
  }, [dispatch])

  /** Edit-and-resend: rewind the thread to `messageId`, then send the edited
   * prompt so the conversation restarts there instead of stacking a copy. */
  const editAndResend = useCallback(async (messageId: string, text: string) => {
    const content = text.trim()
    if (!content || !threadId || busy) return
    setBusy(true); setError(null)
    try {
      await api(`/api/chat/threads/${threadId}/rewind`, {
        method: "POST",
        body: JSON.stringify({ message_id: messageId }),
      })
    } catch (reason) {
      setBusy(false); setError(reason instanceof Error ? reason.message : "Could not rewind to that message")
      return
    }
    // Prune locally first so the optimistic resend lands where the edit was.
    setMessages((items) => {
      const index = items.findIndex((message) => message.id === messageId)
      return index < 0 ? items : items.slice(0, index)
    })
    setBusy(false)
    await send(content)
  }, [threadId, busy, send])

  return { messages, busy, stage, error, setError, send, sendInteraction, refresh, editAndResend }
}

const OPTIONS_LINE = /^\s*Options:\s*(.+)$/im

/** Split Hermes' `Options: A | B | C` convention into text and choices. */
export function splitOptions(content: string): { text: string; options: string[] } {
  const match = content.match(OPTIONS_LINE)
  if (!match) return { text: content, options: [] }
  const options = match[1].split("|").map((option) => option.trim().replace(/^[`*]+|[`*]+$/g, "")).filter(Boolean).slice(0, 3)
  return { text: content.replace(OPTIONS_LINE, "").trim(), options }
}
