"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { parseServerTime } from "@/lib/server-time"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowUp, CalendarDays, Check, Copy, ExternalLink, LoaderCircle, MapPin, Mic, PencilLine, RefreshCw, RotateCcw, Sparkles, Square } from "lucide-react"
import type { CoachActivity } from "@/components/hermes/CoachActivityIcon"
import { CoachLoader } from "@/components/hermes/CoachLoader"
import { MarkdownText } from "@/components/hermes/markdown"
import { splitOptions, type ChatInteractionInput, type ChatMessage, type LiveProgress } from "@/components/hermes/use-hermes-chat"
import { RunProgressCard } from "@/components/hermes/RunProgress"
import { useVoiceInput } from "@/components/hermes/use-voice-input"
import { VoiceWaveform } from "@/components/hermes/VoiceWaveform"
import { cn } from "@/lib/utils"
import { EASE_OUT } from "@/lib/ease"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import { ChatElementView } from "@/components/hermes/elements/ChatElementView"
import "./coach-concept.css"

/** Progressively reveals `text` word-by-word (fast, capped to a couple of seconds) when
 *  `active`. Used only for a just-finished reply — history and already-seen messages render
 *  in full immediately. Reduced motion always renders in full. */
function StreamingReply({ text, active, onDone }: { text: string; active: boolean; onDone: () => void }) {
  // Split on whitespace but keep the separators, so the joined prefix is exact.
  const tokens = useMemo(() => text.split(/(\s+)/).filter((t) => t.length > 0), [text])
  const [count, setCount] = useState(active ? 0 : tokens.length)
  useEffect(() => {
    if (!active) { setCount(tokens.length); return }
    setCount(0)
    const total = tokens.length
    if (total === 0) { onDone(); return }
    const totalMs = Math.min(2200, Math.max(300, total * 16))
    const stepMs = Math.max(10, totalMs / total)
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setCount(i)
      if (i >= total) window.clearInterval(id)
    }, stepMs)
    return () => window.clearInterval(id)
    // onDone is stable enough per message id; re-running on text identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, text])
  useEffect(() => {
    if (active && count >= tokens.length && tokens.length > 0) onDone()
  }, [active, count, tokens.length, onDone])
  return <MarkdownText text={tokens.slice(0, count).join("")} />
}

/** A suggestion chip above the composer. `message` is what fills the composer
 * (follow-ups send immediately instead, via their interaction). */
export interface SuggestedPrompt { label: string; message: string }

interface ChatThreadViewProps {
  messages: ChatMessage[]
  busy: boolean
  stage: string
  /** Live phase/tool/speed/reply-so-far while a run is going (null before the first report). */
  progress?: LiveProgress | null
  error: string | null
  onSend: (text: string) => void
  onInteraction: (interaction: ChatInteractionInput, displayText: string) => void
  onRetry: () => void
  /** Rewind the thread to the message, then resend the edited prompt there. */
  onEditResend: (messageId: string, text: string) => void
  /** Stop the live run. Required whenever busy can be true. */
  onStop: () => void
  placeholder: string
  disabled?: boolean
  empty?: ReactNode
  /** Rendered in-flow under the messages, e.g. pending roadmap drafts. */
  afterMessages?: ReactNode
  /** Prefill (not send) the composer, e.g. from another tab's handoff. */
  draft?: string
  /** Shown when Hermes attached no follow-ups to its latest reply. Every entry
   * must be composed from live backend state (roadmap, facts, drafts) — never
   * static text — and fills the composer so the student can edit first. */
  fallbackPrompts?: SuggestedPrompt[]
  /** Short follow-ups generated for the latest reply (see useChatSuggestions).
   * Clicking one sends it as the student's next message. */
  dynamicPrompts?: string[]
  /** True while dynamic follow-ups are being fetched: chips wait instead of flickering. */
  promptsLoading?: boolean
}

/** use-hermes-chat sets `coach.*` catalog keys for its own stages/errors;
 * anything else (server stages, API error text) is shown as-is. */
const isCoachKey = (value: string): value is MessageKey => /^coach\.[\w.]+$/.test(value)

/** Map the run stage onto what the coach is doing. Server stages are English
 * text ("Hermes is using Waypoint tools"); the label shown is always our own
 * translated one, so model names and internal wording never reach the student. */
export function activityFromStage(stage: string): CoachActivity {
  if (/tool/i.test(stage)) return "tool"
  if (!stage || /think|review|start|queue|wait|approval/i.test(stage)) return "thinking"
  return "writing"
}

/** Message list + composer in the coach concept language (chat-shell interior). */
export function ChatThreadView({ messages, busy, stage, progress = null, error, onSend, onInteraction, onRetry, onEditResend, onStop, placeholder, disabled, empty, afterMessages, draft, fallbackPrompts = [], dynamicPrompts = [], promptsLoading = false }: ChatThreadViewProps) {
  const { t, fmt } = useI18n()
  // Re-pin to the bottom as the live card grows (new step, streamed text), not on every tick.
  const progressSize = progress ? `${progress.value.steps.length}:${progress.value.preview.length >> 6}:${progress.value.notice ? 1 : 0}` : ""
  const display = (value: string) => (isCoachKey(value) ? t(value) : value)
  const formatTime = (iso: string) => {
    const time = parseServerTime(iso)
    return time === null ? "" : fmt.time(time)
  }
  const [input, setInput] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reduce = useReducedMotion()
  // Voice dictation: record with the mic, transcribe server-side, fill the
  // composer as an editable draft. Never auto-sends.
  const fillFromVoice = useCallback((text: string) => {
    setInput((current) => (current ? `${current.replace(/\s+$/, "")} ${text}` : text))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])
  const voice = useVoiceInput(fillFromVoice)
  const formatVoiceTime = (totalSeconds: number) =>
    `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
  // Stick to the bottom while new content arrives, but let go the moment the
  // student scrolls up to read history.
  const stickRef = useRef(true)
  // Height already pinned to. Stage ticks and message polls re-render without
  // adding content — pinning on every one of those yanked the viewport down
  // repeatedly, which read as a super-fast scroll.
  const pinnedHeightRef = useRef(0)
  // Trailing pin timer. On a tab switch the history, proposals, and run
  // status resolve in a staggered burst — without this each one yanked the
  // viewport down in turn, reading as one super-fast scroll. The burst now
  // settles into a single jump.
  const pinTimerRef = useRef<number | null>(null)
  // Word-by-word reveal: only a single freshly-arrived assistant message gets it — never a
  // bulk history load (initial fetch, thread switch) and never an already-seen message. A
  // bare busy->idle transition races the async refresh that actually appends the reply
  // (finishRun flips busy before refresh() resolves), so this keys off the message list
  // itself: the first render just records a baseline, and only a +1 growth ending in an
  // assistant message counts as "new".
  const [revealId, setRevealId] = useState<string | null>(null)
  const prevCountRef = useRef<number | null>(null)
  useEffect(() => {
    const prevCount = prevCountRef.current
    prevCountRef.current = messages.length
    if (prevCount === null) return // first render for this thread: establish the baseline only
    if (messages.length === prevCount + 1) {
      const last = messages[messages.length - 1]
      if (last?.role === "assistant" && !last.id.startsWith("optimistic-")) setRevealId(last.id)
    }
  }, [messages])
  const clearReveal = useCallback((id: string) => {
    setRevealId((current) => (current === id ? null : current))
  }, [])

  useEffect(() => {
    const container = messagesRef.current
    if (!container || !stickRef.current) return
    const target = container.scrollHeight
    if (target <= pinnedHeightRef.current) {
      // No growth (or the thread shrank after an edit/resend rewind) —
      // re-baseline so future growth still follows.
      pinnedHeightRef.current = target
      return
    }
    pinnedHeightRef.current = target
    if (pinTimerRef.current !== null) window.clearTimeout(pinTimerRef.current)
    pinTimerRef.current = window.setTimeout(() => {
      pinTimerRef.current = null
      const el = messagesRef.current
      // The student may have scrolled up while the burst settled — never
      // drag them back down. Direct assignment: always instant, never an
      // animated scroll.
      if (!el || !stickRef.current) return
      el.scrollTop = el.scrollHeight
      pinnedHeightRef.current = el.scrollHeight
    }, 200)
    return () => {
      if (pinTimerRef.current !== null) {
        window.clearTimeout(pinTimerRef.current)
        pinTimerRef.current = null
      }
    }
  }, [messages, stage, busy, afterMessages, progressSize])
  useEffect(() => { if (draft) setInput(draft) }, [draft])

  // Auto-grow the composer like the concept's fluid textarea.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`
  }, [input])

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  const isLast = (message: ChatMessage) => message.id === lastAssistant?.id && messages[messages.length - 1]?.id === message.id

  const submit = (text: string) => {
    if (!text.trim() || busy || disabled) return
    onSend(text)
    setInput("")
  }

  const interactionAnswer = (sourceMessageId: string) => messages.find((item) =>
    item.role === "user" && item.metadata?.interaction?.source_message_id === sourceMessageId,
  )

  // Backend-suggested next prompts: the follow_ups Hermes attached to the
  // latest reply. They render as pills above the composer only while that
  // reply is the thread end and still unanswered — never hardcoded text.
  const threadEnd = messages.length > 0 ? messages[messages.length - 1] : null
  const endFollowUps = threadEnd?.role === "assistant" ? (threadEnd.metadata?.follow_ups ?? []) : []
  const endAnswered = threadEnd ? interactionAnswer(threadEnd.id) : undefined
  const suggestedPrompts = threadEnd?.role === "assistant" && !endAnswered ? endFollowUps.slice(0, 3) : []
  const generated = !suggestedPrompts.length && threadEnd?.role === "assistant" && !endAnswered ? dynamicPrompts.slice(0, 3) : []
  const showFallback = !suggestedPrompts.length && !generated.length && !promptsLoading
  const activity = activityFromStage(stage)

  const choose = (message: ChatMessage, optionId: string, title: string) => {
    const group = message.metadata?.choice_group
    if (!group || busy || disabled || interactionAnswer(message.id)) return
    if (group.mode === "single") {
      setSelections((current) => ({ ...current, [message.id]: [optionId] }))
      onInteraction({ kind: "choice", source_message_id: message.id, selected_option_ids: [optionId] }, title)
      return
    }
    setSelections((current) => {
      const selected = current[message.id] ?? []
      const next = selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : selected.length < group.max_selections ? [...selected, optionId] : selected
      return { ...current, [message.id]: next }
    })
  }

  const submitMultiple = (message: ChatMessage) => {
    const group = message.metadata?.choice_group
    const selected = selections[message.id] ?? []
    if (!group || selected.length < group.min_selections || selected.length > group.max_selections) return
    const titles = group.options.filter((item) => selected.includes(item.id)).map((item) => item.title)
    onInteraction(
      { kind: "choice", source_message_id: message.id, selected_option_ids: selected },
      t("coach.thread.selected", { titles: titles.join(", ") }),
    )
  }

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    } catch {
      // Clipboard blocked: no-op, the text stays selectable.
    }
  }

  const editPrompt = (message: ChatMessage) => {
    setEditingId(message.id)
    setEditDraft(message.content)
  }

  const saveEdit = (messageId: string) => {
    if (!editDraft.trim() || busy || disabled) return
    onEditResend(messageId, editDraft)
    setEditingId(null)
  }

  /** The user prompt that produced the assistant message at `index`. */
  const promptFor = (index: number): { id: string; content: string } | null => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === "user") return { id: messages[i].id, content: messages[i].content }
    }
    return null
  }

  return (
    <div className="fq fq-thread">
      <div
        ref={messagesRef}
        className="chat-messages"
        role="log"
        aria-label={t("coach.thread.logLabel")}
        onScroll={(event) => {
          const el = event.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96
        }}
      >
        {messages.length === 0 ? (
          <div
            className="fq-empty"
          >
            {empty ?? (
              <>
                <span className="empty-mark"><Sparkles size={20} /></span>
                <h2>{t("coach.empty.title")}</h2>
                <p>{t("coach.empty.bodyDefault")}</p>
              </>
            )}
            {fallbackPrompts.length ? (
              <div className="button-row" style={{ justifyContent: "center", marginTop: 18 }}>
                {fallbackPrompts.map((prompt) => (
                  <button key={prompt.label} type="button" disabled={busy || disabled} title={prompt.label} onClick={() => setInput(prompt.message)} className="button secondary small">
                    {prompt.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {messages.map((message, index) => {
            const { text, options } = message.role === "assistant" ? splitOptions(message.content) : { text: message.content, options: [] }
            const prompt = message.role === "assistant" ? promptFor(index) : null
            const copied = copiedId === message.id
            const group = message.role === "assistant" ? message.metadata?.choice_group : null
            const answer = message.role === "assistant" ? interactionAnswer(message.id) : undefined
            const submittedIds = answer?.metadata?.interaction?.selected_option_ids ?? []
            const selectedIds = submittedIds.length ? submittedIds : (selections[message.id] ?? [])
            const controlsEnabled = isLast(message) && !answer && !busy && !disabled
            const time = formatTime(message.created_at)
            return (
              <Fragment key={message.id}>
              <article
                className={cn("message", message.role === "user" ? "user" : "assistant")}
                aria-label={message.role === "user" ? t("coach.thread.yourMessage") : t("coach.thread.hermesReply")}
              >
                {message.role === "assistant" ? (
                  <p className="message-meta">{t("coach.thread.hermes")}</p>
                ) : null}
                {message.role === "user" && editingId === message.id ? (
                  <div className="edit-box">
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveEdit(message.id) }
                        if (event.key === "Escape") setEditingId(null)
                      }}
                      rows={3}
                      dir="auto"
                      autoFocus
                      aria-label={t("coach.thread.editLabel")}
                    />
                    <div className="edit-actions">
                      <button type="button" onClick={() => setEditingId(null)}>{t("coach.thread.cancel")}</button>
                      <button type="button" disabled={!editDraft.trim() || busy || disabled} onClick={() => saveEdit(message.id)} className="edit-save">{t("coach.thread.resend")}</button>
                    </div>
                  </div>
                ) : message.role === "assistant" ? (
                  <div dir="auto">
                    <StreamingReply text={text} active={revealId === message.id && !reduce} onDone={() => clearReveal(message.id)} />
                  </div>
                ) : (
                  <p className="message-p" dir="auto">{text}</p>
                )}
                {group ? (
                  <div>
                    <p className="choice-prompt" dir="auto">{group.prompt}</p>
                    <div className="choice-grid">
                      {group.options.slice(0, 3).map((option) => {
                        const selected = selectedIds.includes(option.id)
                        const opportunity = option.opportunity
                        return (
                          <div
                            key={option.id}
                          >
                            <button
                              type="button"
                              disabled={!controlsEnabled}
                              onClick={() => choose(message, option.id, option.title)}
                              aria-pressed={selected}
                              className="choice"
                            >
                              <span className="choice-mark" aria-hidden="true"><Check size={13} strokeWidth={3.5} /></span>
                              <span className="choice-copy">
                                <strong dir="auto">{option.title}</strong>
                                <span dir="auto">{option.description}</span>
                                {opportunity ? (
                                  <span className="choice-opp">
                                    <span className="opp-fit">{t("coach.thread.fit", { score: fmt.percent(opportunity.score / 100) })}</span>
                                    {opportunity.source_date ? <span className="opp-meta"><CalendarDays size={12} /><bdi>{opportunity.source_date}</bdi></span> : null}
                                    {opportunity.locations.length ? <span className="opp-meta"><MapPin size={12} /><bdi>{opportunity.locations.join(" · ")}</bdi></span> : null}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                            {/* A link may not live inside a button (invalid HTML, unreliable clicks and focus). */}
                            {opportunity && (opportunity.registration_url || opportunity.detail_url) ? (
                              <a
                                className="choice-link"
                                href={opportunity.registration_url || opportunity.detail_url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {t("coach.thread.viewEvent")}<ExternalLink size={12} aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                    {group.mode === "multiple" && controlsEnabled ? (
                      <div className="choice-continue">
                        <span>{t("coach.thread.choose", { count: group.min_selections === group.max_selections ? fmt.number(group.min_selections) : `${fmt.number(group.min_selections)}–${fmt.number(group.max_selections)}` })}</span>
                        <button
                          type="button"
                          disabled={selectedIds.length < group.min_selections || selectedIds.length > group.max_selections}
                          onClick={() => submitMultiple(message)}
                          className="button small"
                        >
                          {selectedIds.length ? t("coach.thread.continueCount", { count: fmt.number(selectedIds.length) }) : t("coach.thread.continue")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {options.length > 0 && !group && isLast(message) ? (
                  <div className="button-row" style={{ marginTop: 14 }}>
                    {options.map((option) => (
                      <button key={option} type="button" disabled={busy || disabled} onClick={() => submit(option)} className="button secondary small" dir="auto">
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" && message.metadata?.elements?.length ? (
                  <div className="chat-elements-stack">
                    {message.metadata.elements.map((element, i) => (
                      <motion.div
                        key={element.id}
                        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.4, ease: EASE_OUT, delay: reduce ? 0 : i * 0.09 }}
                      >
                        <ChatElementView element={element} />
                      </motion.div>
                    ))}
                  </div>
                ) : null}
              </article>
              <div className={`message-tools${message.role === "user" ? " message-tools-user" : ""}`}>
                {time ? <span className="message-time"><bdi>{time}</bdi></span> : null}
                <button type="button" aria-label={message.role === "user" ? t("coach.thread.copyPrompt") : t("coach.thread.copyOutput")} title={copied ? t("coach.thread.copied") : (message.role === "user" ? t("coach.thread.copyPrompt") : t("coach.thread.copyOutput"))} onClick={() => void copyText(message.id, text)}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                {message.role === "user" ? (
                  <button type="button" aria-label={t("coach.thread.editResendLabel")} title={t("coach.thread.editResend")} disabled={busy || disabled || editingId !== null} onClick={() => editPrompt(message)}>
                    <PencilLine size={12} />
                  </button>
                ) : prompt ? (
                  <button type="button" aria-label={t("coach.thread.regenerateLabel")} title={t("coach.thread.regenerate")} disabled={busy || disabled || prompt.id.startsWith("optimistic-")} onClick={() => onEditResend(prompt.id, prompt.content)}>
                    <RotateCcw size={12} />
                  </button>
                ) : null}
              </div>
              </Fragment>
            )
          })}
        </AnimatePresence>
        {afterMessages}
        <AnimatePresence initial={false}>
          {busy ? (
            <div
              key="typing"
              aria-live="polite"
            >
              <div className="message assistant">
                <p className="message-meta">{t("coach.thread.hermes")}</p>
                {progress ? (
                  <RunProgressCard progress={progress.value} receivedAt={progress.receivedAt} />
                ) : (
                  <CoachLoader activity={activity} label={t(`coach.activity.${activity}`)} />
                )}
              </div>
            </div>
          ) : null}
        </AnimatePresence>
        {error ? (
          <div className="fq-error" role="alert">
            <span>{display(error)}</span>
            <button type="button" aria-label={t("coach.thread.retry")} onClick={onRetry}><RefreshCw size={14} /></button>
          </div>
        ) : null}
      </div>
      <div className="composer-wrap">
        {suggestedPrompts.length && !busy && !disabled ? (
          <div className="button-row composer-prompts">
            {suggestedPrompts.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => {
                  if (threadEnd) onInteraction({ kind: "follow_up", source_message_id: threadEnd.id, selected_option_ids: [item.id] }, item.label)
                }}
                className="status"
                aria-label={t("coach.thread.askHermes", { label: item.label })}
                dir="auto"
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {generated.length && !busy && !disabled ? (
          <div className="button-row composer-prompts">
            {generated.map((label) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => onSend(label)}
                className="status"
                aria-label={t("coach.thread.askHermes", { label })}
                dir="auto"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {showFallback && fallbackPrompts.length && !busy && !disabled && messages.length > 0 ? (
          <div className="button-row composer-prompts">
            {fallbackPrompts.map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                title={prompt.label}
                onClick={() => setInput(prompt.message)}
                className="status"
                aria-label={t("coach.thread.draftMessage", { label: prompt.label })}
              >
                {prompt.label}
              </button>
            ))}
          </div>
        ) : null}
        {voice.status !== "idle" ? (
          <div className="voice-status" role="status">
            {voice.status === "recording" ? (
              <>
                <VoiceWaveform analyserRef={voice.analyserRef} mode="live" />
                <span dir="auto">{t("coach.thread.voice.recording", { time: formatVoiceTime(voice.seconds) })}</span>
                <button type="button" onClick={voice.cancel} className="voice-cancel">
                  {t("coach.thread.voice.cancelRecording")}
                </button>
              </>
            ) : (
              <>
                <VoiceWaveform mode="processing" />
                <span className="voice-transcribing">
                  <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                  {t("coach.thread.voice.transcribing")}
                </span>
              </>
            )}
          </div>
        ) : null}
        {voice.error && voice.status === "idle" ? (
          <div className="voice-error" role="alert">
            <span dir="auto">{display(voice.error)}</span>
            <button type="button" onClick={() => voice.setError(null)} aria-label={t("coach.thread.voice.dismiss")}>
              ✕
            </button>
          </div>
        ) : null}
        <div className="composer">
          {voice.status === "recording" ? (
            <button
              type="button"
              aria-label={t("coach.thread.voice.stopRecording")}
              title={t("coach.thread.voice.stopRecording")}
              onClick={voice.stop}
              className="mic-button recording"
            >
              <Square size={17} strokeWidth={2.5} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("coach.thread.voice.dictate")}
              title={t("coach.thread.voice.dictate")}
              disabled={busy || disabled || voice.status === "transcribing"}
              onClick={() => void voice.start()}
              className="mic-button"
            >
              {voice.status === "transcribing"
                ? <LoaderCircle size={18} className="animate-spin" />
                : <Mic size={18} strokeWidth={2.2} />}
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(input) }
              if (event.key === "Escape" && busy) { event.preventDefault(); onStop() }
            }}
            placeholder={busy ? t("coach.thread.busyPlaceholder") : placeholder}
            rows={1}
            dir="auto"
            aria-label={t("coach.thread.messageLabel")}
          />
          {busy ? (
            <motion.button
              type="button"
              aria-label={t("coach.thread.stopGenerating")}
              title={t("coach.thread.stopGenerating")}
              onClick={onStop}
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.94 }}
              className="send-button"
              data-stop=""
            >
              <Square size={16} fill="currentColor" aria-hidden="true" />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              aria-label={t("coach.thread.send")}
              disabled={!input.trim() || busy || disabled}
              onClick={() => submit(input)}
              whileHover={reduce || !input.trim() || disabled ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.94 }}
              className="send-button"
            >
              <ArrowUp size={20} strokeWidth={2.5} aria-hidden="true" />
            </motion.button>
          )}
        </div>
      </div>
    </div>
  )
}
