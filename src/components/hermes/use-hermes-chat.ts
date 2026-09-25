"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

/** Newest agent run for a thread, for resume-after-navigation and global status. */
export interface ActiveRun { id: string; status: string; stage: string; error: string | null; created_at: string }

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"])
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"])
/** A "running" run older than this is presumed orphaned (e.g. server restarted mid-run). */
const STALE_RUN_MS = 10 * 60 * 1000

export function isLiveRun(run: ActiveRun | null): run is ActiveRun {
  if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) return false
  const started = Date.parse(run.created_at)
  if (Number.isNaN(started)) return true
  return Date.now() - started < STALE_RUN_MS
}

/** Messages, sending, and live run status for one Hermes chat thread. */
export function useHermesChat(threadId: string | null, onRunFinished?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<EventSource | null>(null)
  // In-flight guard as a ref: `busy` state can still read stale inside a
  // second invoke from the same tick (double click/Enter), which would send
  // twice and stack duplicate turns. The ref makes double-dispatch impossible.
  const busyRef = useRef(false)
  const onRunFinishedRef = useRef(onRunFinished)
  onRunFinishedRef.current = onRunFinished

  const closeStream = useCallback(() => {
    streamRef.current?.close()
    streamRef.current = null
  }, [])

  useEffect(() => () => { closeStream(); busyRef.current = false }, [closeStream])

  const refresh = useCallback(async () => {
    if (!threadId) return
    setMessages(await api<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`))
  }, [threadId])

  /** Attach to a run's progress stream; survives as long as this hook is mounted. */
  const watchRun = useCallback((runId: string) => {
    closeStream()
    busyRef.current = true
    setBusy(true)
    const source = new EventSource(`${API_BASE}/api/agent-runs/${runId}/events`)
    streamRef.current = source
    source.addEventListener("status", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { status: string; stage: string; error?: string }
      setStage(payload.stage)
      if (TERMINAL_RUN_STATUSES.has(payload.status)) {
        closeStream(); busyRef.current = false; setBusy(false); setStage("")
        if (payload.error) setError(payload.error)
        refresh().catch(() => undefined)
        onRunFinishedRef.current?.()
      }
    })
    source.onerror = () => { closeStream(); busyRef.current = false; setBusy(false); setError("Lost the Hermes progress stream. Your message is saved; refresh to check it.") }
  }, [closeStream, refresh])

  // Load history, then resume watching a run that is still generating —
  // e.g. the student sent a message, switched sections, and came back.
  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    refresh().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not reach Farq API")
    })
    api<{ run: ActiveRun | null }>(`/api/chat/threads/${threadId}/runs/latest`)
      .then(({ run }) => {
        if (cancelled || busyRef.current || !isLiveRun(run)) return
        setStage(run.stage || "Hermes is working")
        watchRun(run.id)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [threadId, refresh, watchRun])

  const dispatch = useCallback(async (
    payload: { content?: string; interaction?: ChatInteractionInput },
    optimistic: Omit<ChatMessage, "id" | "role" | "created_at">,
  ) => {
    if (!threadId || busyRef.current) return
    busyRef.current = true
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
      watchRun(result.run_id)
    } catch (reason) {
      busyRef.current = false
      setBusy(false); setError(reason instanceof Error ? reason.message : "Could not start Hermes")
      await refresh().catch(() => undefined)
    }
  }, [threadId, refresh, watchRun])

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
   * prompt so the conversation restarts there instead of stacking a copy.
   * The resend only fires after the server confirms the old turn is gone, so
   * a stale prune or a failed rewind can never stack a duplicate message. */
  const editAndResend = useCallback(async (messageId: string, text: string) => {
    const content = text.trim()
    if (!content || !threadId || busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null)
    try {
      await api(`/api/chat/threads/${threadId}/rewind`, {
        method: "POST",
        body: JSON.stringify({ message_id: messageId }),
      })
    } catch (reason) {
      busyRef.current = false
      setBusy(false); setError(reason instanceof Error ? reason.message : "Could not rewind to that message")
      return
    }
    // Confirm the rewind landed before resending: adopt server truth as the
    // local state. If the old turn is still there, stop instead of stacking.
    let rewound: ChatMessage[]
    try {
      rewound = await api<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`)
    } catch (reason) {
      busyRef.current = false
      setBusy(false); setError(reason instanceof Error ? reason.message : "Could not confirm the rewind")
      return
    }
    if (rewound.some((message) => message.id === messageId)) {
      busyRef.current = false
      setBusy(false); setError("Hermes kept the old turn — nothing was resent. Try again.")
      setMessages(rewound)
      return
    }
    setMessages(rewound)
    busyRef.current = false
    setBusy(false)
    await send(content)
  }, [threadId, send])

  return { messages, busy, stage, error, setError, send, sendInteraction, refresh, editAndResend }
}

/** Live run for a thread, polled so any section can show Hermes is generating. */
export function useActiveRun(threadId: string | null, pollMs = 5000): ActiveRun | null {
  const [run, setRun] = useState<ActiveRun | null>(null)
  useEffect(() => {
    if (!threadId) { setRun(null); return }
    let cancelled = false
    const check = async () => {
      if (document.hidden) return
      try {
        const { run: latest } = await api<{ run: ActiveRun | null }>(`/api/chat/threads/${threadId}/runs/latest`)
        if (!cancelled) setRun(isLiveRun(latest) ? latest : null)
      } catch {
        // Keep the last known state; the next poll retries.
      }
    }
    void check()
    const timer = window.setInterval(check, pollMs)
    const onVisible = () => { void check() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible) }
  }, [threadId, pollMs])
  return run
}

const OPTIONS_LINE = /^\s*Options:\s*(.+)$/im

/** Split Hermes' `Options: A | B | C` convention into text and choices. */
export function splitOptions(content: string): { text: string; options: string[] } {
  const match = content.match(OPTIONS_LINE)
  if (!match) return { text: content, options: [] }
  const options = match[1].split("|").map((option) => option.trim().replace(/^[`*]+|[`*]+$/g, "")).filter(Boolean).slice(0, 3)
  return { text: content.replace(OPTIONS_LINE, "").trim(), options }
}
