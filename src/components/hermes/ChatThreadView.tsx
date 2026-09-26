"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowUp, CalendarDays, Check, Copy, ExternalLink, MapPin, PencilLine, RefreshCw, RotateCcw, Sparkles, Square } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { splitOptions, type ChatInteractionInput, type ChatMessage } from "@/components/hermes/use-hermes-chat"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import "./coach-concept.css"

/** A suggestion chip above the composer. `message` is what fills the composer
 * (follow-ups send immediately instead, via their interaction). */
export interface SuggestedPrompt { label: string; message: string }

interface ChatThreadViewProps {
  messages: ChatMessage[]
  busy: boolean
  stage: string
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
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

/** Message list + composer in the coach concept language (chat-shell interior). */
export function ChatThreadView({ messages, busy, stage, error, onSend, onInteraction, onRetry, onEditResend, onStop, placeholder, disabled, empty, afterMessages, draft, fallbackPrompts = [] }: ChatThreadViewProps) {
  const [input, setInput] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const container = messagesRef.current
    container?.scrollTo({ top: container.scrollHeight, behavior: reduce ? "auto" : "smooth" })
  }, [messages, stage, reduce])
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
      `Selected: ${titles.join(", ")}`,
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
  const promptFor = (index: number): string | null => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content
    }
    return null
  }

  return (
    <div className="fq fq-thread">
      <div ref={messagesRef} className="chat-messages" role="log" aria-label="Conversation with Hermes">
        {messages.length === 0 ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
            className="fq-empty"
          >
            {empty ?? (
              <>
                <span className="empty-mark"><Sparkles size={20} /></span>
                <h2>Shape your roadmap through conversation</h2>
                <p>Tell Hermes what you enjoy, what you struggle with, or ask it to compare two possible branches.</p>
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
          </motion.div>
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
              <motion.article
                key={message.id}
                layout={reduce ? undefined : "position"}
                initial={reduce ? false : { opacity: 0, y: 14, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.32, ease: EASE_OUT }}
                className={cn("message", message.role === "user" ? "user" : "assistant")}
                aria-label={message.role === "user" ? "Your message" : "Hermes reply"}
              >
                <p className="message-meta">
                  {message.role === "user" ? "You" : "Hermes"}{time ? ` · ${time}` : ""}
                </p>
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
                      autoFocus
                      aria-label="Edit your message"
                    />
                    <div className="edit-actions">
                      <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      <button type="button" disabled={!editDraft.trim() || busy || disabled} onClick={() => saveEdit(message.id)} className="edit-save">Resend</button>
                    </div>
                  </div>
                ) : message.role === "assistant" ? (
                  <MarkdownText text={text} />
                ) : (
                  <p className="message-p">{text}</p>
                )}
                {group ? (
                  <div>
                    <p className="choice-prompt">{group.prompt}</p>
                    <div className="choice-grid">
                      {group.options.slice(0, 3).map((option, optionIndex) => {
                        const selected = selectedIds.includes(option.id)
                        const opportunity = option.opportunity
                        return (
                          <motion.div
                            key={option.id}
                            initial={reduce ? false : { opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.28, delay: Math.min(optionIndex * 0.05, 0.15), ease: EASE_OUT }}
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
                                <strong>{option.title}</strong>
                                <span>{option.description}</span>
                                {opportunity ? (
                                  <span className="choice-opp">
                                    <span className="opp-fit">Hackathonat · {opportunity.score}% fit</span>
                                    {opportunity.source_date ? <span className="opp-meta"><CalendarDays size={12} />{opportunity.source_date}</span> : null}
                                    {opportunity.locations.length ? <span className="opp-meta"><MapPin size={12} />{opportunity.locations.join(" · ")}</span> : null}
                                    {(opportunity.registration_url || opportunity.detail_url) ? (
                                      <a
                                        href={opportunity.registration_url || opportunity.detail_url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        View event<ExternalLink size={12} />
                                      </a>
                                    ) : null}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </motion.div>
                        )
                      })}
                    </div>
                    {group.mode === "multiple" && controlsEnabled ? (
                      <div className="choice-continue">
                        <span>Choose {group.min_selections === group.max_selections ? group.min_selections : `${group.min_selections}–${group.max_selections}`}</span>
                        <button
                          type="button"
                          disabled={selectedIds.length < group.min_selections || selectedIds.length > group.max_selections}
                          onClick={() => submitMultiple(message)}
                          className="button small"
                        >
                          Continue{selectedIds.length ? ` (${selectedIds.length})` : ""}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {options.length > 0 && !group && isLast(message) ? (
                  <div className="button-row" style={{ marginTop: 14 }}>
                    {options.map((option) => (
                      <button key={option} type="button" disabled={busy || disabled} onClick={() => submit(option)} className="button secondary small">
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="message-tools">
                  <button type="button" aria-label={message.role === "user" ? "Copy prompt" : "Copy output"} onClick={() => void copyText(message.id, text)}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}
                  </button>
                  {message.role === "user" ? (
                    <button type="button" aria-label="Edit prompt and resend" disabled={busy || disabled || editingId !== null} onClick={() => editPrompt(message)}>
                      <PencilLine size={12} />Edit &amp; resend
                    </button>
                  ) : prompt ? (
                    <button type="button" aria-label="Regenerate from prompt" disabled={busy || disabled} onClick={() => submit(prompt)}>
                      <RotateCcw size={12} />Regenerate
                    </button>
                  ) : null}
                </div>
              </motion.article>
            )
          })}
        </AnimatePresence>
        {afterMessages}
        <AnimatePresence initial={false}>
          {busy ? (
            <motion.div
              key="typing"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              aria-live="polite"
            >
              <div className="message assistant">
                <p className="message-meta">Hermes · generating</p>
                <div className="typing-dots" aria-hidden="true"><span /><span /><span /></div>
                <p className="typing-stage">{stage || "Hermes is working"}</p>
                <div className="button-row" style={{ marginTop: 12 }}>
                  <button type="button" onClick={onStop} className="button secondary small" aria-label="Stop generating">
                    <Square size={13} />Stop
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {error ? (
          <div className="fq-error" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Retry" onClick={onRetry}><RefreshCw size={14} /></button>
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
                aria-label={`Ask Hermes: ${item.label}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {!suggestedPrompts.length && fallbackPrompts.length && !busy && !disabled && messages.length > 0 ? (
          <div className="button-row composer-prompts">
            {fallbackPrompts.map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                title={prompt.label}
                onClick={() => setInput(prompt.message)}
                className="status"
                aria-label={`Draft message: ${prompt.label}`}
              >
                {prompt.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="composer">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(input) }
              if (event.key === "Escape" && busy) { event.preventDefault(); onStop() }
            }}
            placeholder={busy ? "Hermes is generating — press Stop or Esc to interrupt…" : placeholder}
            rows={1}
            aria-label="Message Hermes"
          />
          {busy ? (
            <motion.button
              type="button"
              aria-label="Stop generating"
              title="Stop generating"
              onClick={onStop}
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.94 }}
              className="send-button"
              style={{ background: "var(--fq-danger, #bf3f53)" }}
            >
              <Square size={18} strokeWidth={2.5} />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              aria-label="Send message"
              disabled={!input.trim() || busy || disabled}
              onClick={() => submit(input)}
              whileHover={reduce ? undefined : { y: -1, rotate: -2 }}
              whileTap={reduce ? undefined : { scale: 0.94 }}
              className="send-button"
            >
              <ArrowUp size={19} strokeWidth={2.5} />
            </motion.button>
          )}
        </div>
      </div>
    </div>
  )
}
