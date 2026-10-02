"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { API_BASE, api, runErrorMessage, withIdentityQuery } from "@/lib/waypoint-api"
import { parseServerTime } from "@/lib/server-time"
import type { RunProgress } from "@/components/hermes/RunProgress"

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
  /** Onboarding: Hermes said it knows enough (waypoint_ready_to_generate). */
  ready_to_generate?: boolean
}
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; metadata?: ChatMessageMetadata | null; created_at: string }
export interface ChatInteractionInput {
  kind: "choice" | "follow_up"
  source_message_id: string
  selected_option_ids: string[]
}

export interface LiveProgress { value: RunProgress; receivedAt: number }
interface RunStatusPayload { status: string; stage: string; error?: string | null; progress?: RunProgress | null }

/** Newest agent run for a thread, for resume-after-navigation and global status. */
/** Stage and error values this hook sets itself are `coach.*` catalog keys;
 * the view translates them. Server-sent stages/errors stay free text. */

export interface ActiveRun { id: string; status: string; stage: string; error: string | null; created_at: string }

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"])
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"])
/** A "running" run older than this is presumed orphaned (e.g. server restarted mid-run). */
const STALE_RUN_MS = 10 * 60 * 1000

export function isLiveRun(run: ActiveRun | null): run is ActiveRun {
  if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) return false
  const started = parseServerTime(run.created_at)
  if (started === null) return true
  return Date.now() - started < STALE_RUN_MS
}

/** Messages, sending, and live run status for one Hermes chat thread. */
export function useHermesChat(threadId: string | null, onRunFinished?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState("")
  // Live phase/tool/speed/reply-so-far of the current run, with the local time it arrived.
  const [progress, setProgress] = useState<LiveProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const streamRef = useRef<EventSource | null>(null)
  const pollRef = useRef<number | null>(null)
  // In-flight guard as a ref: `busy` state can still read stale inside a
  // second invoke from the same tick (double click/Enter), which would send
  // twice and stack duplicate turns. The ref makes double-dispatch impossible.
  const busyRef = useRef(false)
  // Current run id for Stop, plus a flag for Stop pressed in the tiny window
  // between send and the new run id arriving from the server.
  const runIdRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const onRunFinishedRef = useRef(onRunFinished)
  onRunFinishedRef.current = onRunFinished

  const closeStream = useCallback(() => {
    streamRef.current?.close()
    streamRef.current = null
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => { closeStream(); busyRef.current = false }, [closeStream])

  const refresh = useCallback(async () => {
    if (!threadId) return
    setMessages(await api<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`))
  }, [threadId])

  /** The error banner's Try again: clear the banner once the thread reloads. */
  const retry = useCallback(async () => {
    await refresh()
    setError(null)
  }, [refresh])

  const finishRun = useCallback((terminalError: string | null, terminalStatus: string) => {
    closeStream()
    busyRef.current = false
    runIdRef.current = null
    setRunId(null)
    setBusy(false)
    setStage("")
    setProgress(null)
    // A student stop is intentional, never an error banner.
    if (terminalStatus === "cancelled") setError(null)
    else if (terminalError) setError(runErrorMessage(terminalError))
  }, [closeStream])

  /** Attach to a run's progress stream; survives as long as this hook is mounted. */
  const watchRun = useCallback((runIdToWatch: string) => {
    closeStream()
    busyRef.current = true
    runIdRef.current = runIdToWatch
    setRunId(runIdToWatch)
    setBusy(true)
    const handle = (payload: RunStatusPayload) => {
      setStage(payload.stage)
      setProgress(payload.progress ? { value: payload.progress, receivedAt: Date.now() } : null)
      if (TERMINAL_RUN_STATUSES.has(payload.status)) {
        finishRun(payload.error ?? null, payload.status)
        refresh().catch(() => undefined)
        onRunFinishedRef.current?.()
      }
    }
    const source = new EventSource(withIdentityQuery(`${API_BASE}/api/agent-runs/${runIdToWatch}/events`))
    streamRef.current = source
    source.addEventListener("status", (event) => {
      try {
        handle(JSON.parse((event as MessageEvent).data) as RunStatusPayload)
      } catch {
        // A malformed frame is skipped; the next status (or the poll fallback) carries the truth.
      }
    })
    // The run keeps going on the server when the stream drops (proxy timeout, sleep, Wi-Fi):
    // keep following it by polling instead of declaring it lost and re-enabling Send.
    source.onerror = () => {
      source.close()
      if (streamRef.current === source) streamRef.current = null
      if (pollRef.current !== null || runIdRef.current !== runIdToWatch) return
      let failures = 0
      pollRef.current = window.setInterval(() => {
        api<RunStatusPayload>(`/api/agent-runs/${runIdToWatch}`)
          .then((run) => { failures = 0; handle(run) })
          .catch(() => {
            failures += 1
            if (failures >= 5) {
              closeStream(); busyRef.current = false; runIdRef.current = null; setRunId(null); setBusy(false); setError("coach.errors.streamLost")
            }
          })
      }, 2000)
    }
  }, [closeStream, refresh, finishRun])

  // Load history, then resume watching a run that is still generating —
  // e.g. the student sent a message, switched sections, and came back.
  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    refresh().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "coach.errors.unreachable")
    })
    api<{ run: ActiveRun | null }>(`/api/chat/threads/${threadId}/runs/latest`)
      .then(({ run }) => {
        if (cancelled || busyRef.current || !isLiveRun(run)) return
        setStage(run.stage || "coach.stage.working")
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
    stopRequestedRef.current = false
    setBusy(true); setError(null)
    setMessages((items) => [...items, { ...optimistic, id: `optimistic-${Date.now()}`, role: "user", created_at: new Date().toISOString() }])
    try {
      // No model in the request: the server runs the Settings choice and its fallback ladder.
      const result = await api<{ run_id: string }>(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      window.dispatchEvent(new Event(RUN_STARTED_EVENT))
      // Stop was pressed while the send was in flight: cancel the run that
      // just started instead of watching it.
      if (stopRequestedRef.current) {
        stopRequestedRef.current = false
        try {
          await api(`/api/agent-runs/${result.run_id}/cancel`, { method: "POST" })
        } catch {
          // The run may already be terminal; fall through to refresh.
        }
        busyRef.current = false
        runIdRef.current = null
        setRunId(null)
        setBusy(false)
        setStage("")
        await refresh().catch(() => undefined)
        onRunFinishedRef.current?.()
        return
      }
      setStage("coach.stage.starting")
      watchRun(result.run_id)
    } catch (reason) {
      busyRef.current = false
      runIdRef.current = null
      setRunId(null)
      setBusy(false); setError(reason instanceof Error ? reason.message : "coach.errors.startFailed")
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
      setBusy(false); setError(reason instanceof Error ? reason.message : "coach.errors.rewindFailed")
      return
    }
    // Confirm the rewind landed before resending: adopt server truth as the
    // local state. If the old turn is still there, stop instead of stacking.
    let rewound: ChatMessage[]
    try {
      rewound = await api<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`)
    } catch (reason) {
      busyRef.current = false
      setBusy(false); setError(reason instanceof Error ? reason.message : "coach.errors.rewindConfirmFailed")
      return
    }
    if (rewound.some((message) => message.id === messageId)) {
      busyRef.current = false
      setBusy(false); setError("coach.errors.rewindKept")
      setMessages(rewound)
      return
    }
    setMessages(rewound)
    busyRef.current = false
    setBusy(false)
    await send(content)
  }, [threadId, send])

  /** Stop the live run. The UI unsticks immediately; the server marks the
   * run cancelled and the background worker discards its late answer. */
  const stop = useCallback(async () => {
    if (!busyRef.current && !runIdRef.current) return
    stopRequestedRef.current = true
    const runToStop = runIdRef.current
    const threadToStop = threadIdRef.current
    // Unstick the UI first so a slow cancel never leaves a dead spinner.
    closeStream()
    busyRef.current = false
    runIdRef.current = null
    setRunId(null)
    setBusy(false)
    setStage("")
    setError(null)
    try {
      if (runToStop) {
        await api(`/api/agent-runs/${runToStop}/cancel`, { method: "POST" })
      } else if (threadToStop) {
        await api(`/api/chat/threads/${threadToStop}/runs/cancel`, { method: "POST" })
      }
    } catch {
      // The stream is already closed and busy cleared; a failed cancel just
      // means the run already finished — refresh picks up the truth.
    } finally {
      stopRequestedRef.current = false
      await refresh().catch(() => undefined)
      onRunFinishedRef.current?.()
    }
  }, [closeStream, refresh])

  return { messages, busy, stage, progress, error, setError, send, sendInteraction, refresh, retry, editAndResend, stop, runId }
}

/** Fired when this tab starts a Hermes run, so useActiveRun checks at once instead of at its idle pace. */
export const RUN_STARTED_EVENT = "waypoint:hermes-run-started"

/** Live run for a thread, polled so any section can show Hermes is generating. Polls every
 *  `pollMs` while a run is live and at `idleMs` otherwise (a run started in this tab is picked up
 *  at once via RUN_STARTED_EVENT; one started elsewhere within `idleMs`). */
export function useActiveRun(threadId: string | null, pollMs = 2000, idleMs = 15000): ActiveRun | null {
  const [run, setRun] = useState<ActiveRun | null>(null)
  useEffect(() => {
    if (!threadId) { setRun(null); return }
    let cancelled = false
    let timer: number | undefined
    let live = false
    const schedule = () => {
      window.clearTimeout(timer)
      if (!cancelled) timer = window.setTimeout(check, live ? pollMs : idleMs)
    }
    const check = async () => {
      if (document.hidden) { schedule(); return }
      try {
        const { run: latest } = await api<{ run: ActiveRun | null }>(`/api/chat/threads/${threadId}/runs/latest`)
        const next = isLiveRun(latest) ? latest : null
        live = next !== null
        // Keep the same object while nothing changed, so the whole app does not re-render every poll.
        if (!cancelled) setRun((current) => (current && next && current.id === next.id && current.status === next.status && current.stage === next.stage ? current : next))
      } catch {
        // Keep the last known state; the next poll retries.
      }
      schedule()
    }
    void check()
    const now = () => { void check() }
    document.addEventListener("visibilitychange", now)
    window.addEventListener(RUN_STARTED_EVENT, now)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", now)
      window.removeEventListener(RUN_STARTED_EVENT, now)
    }
  }, [threadId, pollMs, idleMs])
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

/**
 * Short follow-up chips for the newest assistant reply, generated server-side
 * from only the last exchange (see services/api/app/suggestions.py). Resolves to
 * an empty list when no model is configured, on error, or after ~5s, so the
 * caller falls back to its heuristic chips. `loading` is true only while a
 * request is in flight.
 */
export function useChatSuggestions(threadId: string | null, messages: ChatMessage[], busy: boolean): { prompts: string[]; loading: boolean } {
  const end = messages.length ? messages[messages.length - 1] : null
  const eligibleId = threadId && end && end.role === "assistant" && !busy
    && !end.id.startsWith("optimistic-")
    && !end.metadata?.follow_ups?.length && !end.metadata?.choice_group
    ? end.id : null
  const cache = useRef(new Map<string, string[]>())
  const [state, setState] = useState<{ id: string | null; prompts: string[]; loading: boolean }>({ id: null, prompts: [], loading: false })

  useEffect(() => {
    if (!threadId || !eligibleId) { setState({ id: null, prompts: [], loading: false }); return }
    const key = `${threadId}:${eligibleId}`
    const cached = cache.current.get(key)
    if (cached) { setState({ id: eligibleId, prompts: cached, loading: false }); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 5000)
    setState({ id: eligibleId, prompts: [], loading: true })
    api<{ suggestions: string[] }>(`/api/chat/threads/${threadId}/suggestions?message_id=${encodeURIComponent(eligibleId)}`, { signal: controller.signal })
      .then((result) => {
        const prompts = Array.isArray(result.suggestions) ? result.suggestions.filter((item) => typeof item === "string").slice(0, 3) : []
        if (prompts.length) cache.current.set(key, prompts)
        setState({ id: eligibleId, prompts, loading: false })
      })
      .catch(() => setState({ id: eligibleId, prompts: [], loading: false }))
      .finally(() => window.clearTimeout(timer))
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [threadId, eligibleId])

  // A stale result for an older message must never show against a newer one.
  if (!eligibleId) return { prompts: [], loading: false }
  if (state.id !== eligibleId) return { prompts: [], loading: true }
  return { prompts: state.prompts, loading: state.loading }
}
