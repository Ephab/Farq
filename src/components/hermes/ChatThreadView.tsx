"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowUp, CalendarDays, Check, Copy, ExternalLink, MapPin, PencilLine, RefreshCw, RotateCcw, Sparkles } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { splitOptions, type ChatInteractionInput, type ChatMessage } from "@/components/hermes/use-hermes-chat"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

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
  placeholder: string
  disabled?: boolean
  empty?: ReactNode
  /** Rendered in-flow under the messages, e.g. the onboarding generate button. */
  afterMessages?: ReactNode
  /** Prefill (not send) the composer, e.g. from suggestion chips in `empty`. */
  draft?: string
  /** Quick prompt chips rendered above the composer; clicking fills the input. */
  quickPrompts?: string[]
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

/** Message list + composer shared by Hermes Coach and the onboarding chat. */
export function ChatThreadView({ messages, busy, stage, error, onSend, onInteraction, onRetry, onEditResend, placeholder, disabled, empty, afterMessages, draft, quickPrompts = [] }: ChatThreadViewProps) {
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
    <>
      <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
            >
              {empty ?? (
                <div className="rounded-3xl border border-dashed border-border bg-background p-8 text-center shadow-sm">
                  <Sparkles className="mx-auto size-7 text-primary" />
                  <h2 className="mt-3 text-lg font-semibold tracking-tight">Shape your roadmap through conversation</h2>
                  <p className="mx-auto mt-2 max-w-md text-[15px] text-muted-foreground">Tell Hermes what you enjoy, what you struggle with, or ask it to compare two possible branches.</p>
                </div>
              )}
            </motion.div>
          ) : null}
          <AnimatePresence initial={false}>
            {messages.map((message, index) => {
              const { text, options } = message.role === "assistant" ? splitOptions(message.content) : { text: message.content, options: [] }
              const prompt = message.role === "assistant" ? promptFor(index) : null
              const copied = copiedId === message.id
              const group = message.role === "assistant" ? message.metadata?.choice_group : null
              const followUps = message.role === "assistant" ? (message.metadata?.follow_ups ?? []).slice(0, 3) : []
              const answer = message.role === "assistant" ? interactionAnswer(message.id) : undefined
              const submittedIds = answer?.metadata?.interaction?.selected_option_ids ?? []
              const selectedIds = submittedIds.length ? submittedIds : (selections[message.id] ?? [])
              const controlsEnabled = isLast(message) && !answer && !busy && !disabled
              const time = formatTime(message.created_at)
              return (
                <motion.div
                  key={message.id}
                  layout={reduce ? undefined : "position"}
                  initial={reduce ? false : { opacity: 0, y: 14, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.32, ease: EASE_OUT }}
                  className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}
                >
                  {message.role === "user" && editingId === message.id ? (
                    <div className="w-full max-w-[88%] rounded-3xl rounded-tr-md border border-primary/50 bg-background p-2 shadow-sm sm:max-w-[76%]">
                      <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveEdit(message.id) } if (event.key === "Escape") setEditingId(null) }} rows={3} autoFocus className="max-h-40 min-h-16 w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none" />
                      <div className="flex justify-end gap-1.5 px-1 pb-1">
                        <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-muted">Cancel</button>
                        <button type="button" disabled={!editDraft.trim() || busy || disabled} onClick={() => saveEdit(message.id)} className="rounded-lg bg-primary px-2.5 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40">Resend</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "px-[17px] py-[15px] text-[15px] leading-7 shadow-sm",
                        message.role === "user"
                          ? "max-w-[88%] rounded-3xl rounded-tr-md bg-foreground text-background sm:max-w-[76%]"
                          : "w-full max-w-[100%] rounded-3xl rounded-tl-md border border-border bg-background sm:max-w-[100%]",
                      )}
                    >
                      <p className={cn("mb-2 text-xs font-semibold", message.role === "user" ? "text-background/60" : "text-muted-foreground")}>
                        {message.role === "user" ? "You" : "Hermes"}{time ? ` · ${time}` : ""}
                      </p>
                      {message.role === "assistant" ? <MarkdownText text={text} /> : <p className="whitespace-pre-wrap">{text}</p>}
                    </div>
                  )}
                  {group ? (
                    <div className="mt-3 w-full">
                      <p className="px-1 text-[13px] font-medium text-muted-foreground">{group.prompt}</p>
                      <div className="mt-2 grid gap-2">
                        {group.options.slice(0, 3).map((option, optionIndex) => {
                          const selected = selectedIds.includes(option.id)
                          const opportunity = option.opportunity
                          return (
                            <motion.div
                              key={option.id}
                              initial={reduce ? false : { opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.28, delay: Math.min(optionIndex * 0.05, 0.15), ease: EASE_OUT }}
                              className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
                            >
                              <motion.button
                                type="button"
                                disabled={!controlsEnabled}
                                onClick={() => choose(message, option.id, option.title)}
                                whileTap={controlsEnabled && !reduce ? { scale: 0.99 } : undefined}
                                className={cn(
                                  "flex w-full items-start gap-3 p-[15px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
                                  selected ? "bg-primary/[0.07]" : "hover:bg-muted/50",
                                )}
                              >
                                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center border", group.mode === "single" ? "rounded-full" : "rounded-lg", selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-transparent")}>
                                  {selected ? <Check className="size-3.5" strokeWidth={3} /> : <Check className="size-3.5" strokeWidth={3} />}
                                </span>
                                <span className="min-w-0"><span className="block text-[15px] font-semibold">{option.title}</span><span className="mt-0.5 block text-[13px] leading-6 text-muted-foreground">{option.description}</span></span>
                              </motion.button>
                              {opportunity ? (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                                  <span className="font-semibold text-foreground">Hackathonat · {opportunity.score}% fit</span>
                                  {opportunity.source_date ? <span className="flex items-center gap-1"><CalendarDays className="size-3" />{opportunity.source_date}</span> : null}
                                  {opportunity.locations.length ? <span className="flex items-center gap-1"><MapPin className="size-3" />{opportunity.locations.join(" · ")}</span> : null}
                                  {(opportunity.registration_url || opportunity.detail_url) ? <a href={opportunity.registration_url || opportunity.detail_url} target="_blank" rel="noreferrer noopener" className="ml-auto flex items-center gap-1 font-medium text-primary hover:underline">View event<ExternalLink className="size-3" /></a> : null}
                                </div>
                              ) : null}
                            </motion.div>
                          )
                        })}
                      </div>
                      {group.mode === "multiple" && controlsEnabled ? (
                        <div className="flex items-center justify-between gap-3 px-1 pt-2">
                          <span className="text-xs text-muted-foreground">Choose {group.min_selections === group.max_selections ? group.min_selections : `${group.min_selections}–${group.max_selections}`}</span>
                          <button type="button" disabled={selectedIds.length < group.min_selections || selectedIds.length > group.max_selections} onClick={() => submitMultiple(message)} className="rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-40">Continue{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {options.length > 0 && !group && isLast(message) ? (
                    <div className="mt-2 flex max-w-[88%] flex-wrap gap-2">
                      {options.map((option) => <button key={option} type="button" disabled={busy || disabled} onClick={() => submit(option)} className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-primary/10 disabled:opacity-40">{option}</button>)}
                    </div>
                  ) : null}
                  {followUps.length ? (
                    <div className="mt-3 w-full">
                      <p className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Explore next</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {followUps.map((item) => {
                          const selected = answer?.metadata?.interaction?.kind === "follow_up" && submittedIds.includes(item.id)
                          return <button key={item.id} type="button" disabled={!controlsEnabled} onClick={() => onInteraction({ kind: "follow_up", source_message_id: message.id, selected_option_ids: [item.id] }, item.label)} className={cn("rounded-xl border px-3 py-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default", selected ? "border-foreground bg-foreground text-background" : "border-border bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground")}>{item.label}</button>
                        })}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button type="button" aria-label={message.role === "user" ? "Copy prompt" : "Copy output"} onClick={() => void copyText(message.id, text)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}
                    </button>
                    {message.role === "user" ? (
                      <button type="button" aria-label="Edit prompt and resend" disabled={busy || disabled || editingId !== null} onClick={() => editPrompt(message)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                        <PencilLine className="size-3" />Edit & resend
                      </button>
                    ) : prompt ? (
                      <button type="button" aria-label="Regenerate from prompt" disabled={busy || disabled} onClick={() => submit(prompt)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                        <RotateCcw className="size-3" />Regenerate
                      </button>
                    ) : null}
                  </div>
                </motion.div>
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
                className="flex items-start"
                aria-live="polite"
              >
                <div className="rounded-3xl rounded-tl-md border border-border bg-background px-[17px] py-[15px] shadow-sm">
                  <div className="flex items-center gap-1.5" aria-hidden="true">
                    {[0, 1, 2].map((dot) => (
                      <motion.span
                        key={dot}
                        className="size-1.5 rounded-full bg-muted-foreground"
                        animate={reduce ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                        transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.15, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">{stage || "Hermes is working"}</p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {error ? <div className="flex items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[15px] text-destructive"><span>{error}</span><button type="button" aria-label="Retry" onClick={onRetry}><RefreshCw className="size-4" /></button></div> : null}
        </div>
      </div>
      <div className="border-t border-border px-4 pb-4 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-[680px]">
          {quickPrompts.length ? (
            <div className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" disabled={busy || disabled} onClick={() => setInput(prompt)} className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted-foreground/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 rounded-2xl border border-border bg-background p-2.5 shadow-sm transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(input) } }}
              placeholder={placeholder}
              rows={1}
              aria-label="Message Hermes"
              className="max-h-[130px] min-h-12 w-full resize-none bg-transparent px-3 py-3 text-[15px] leading-7 outline-none placeholder:text-muted-foreground"
            />
            <motion.button
              type="button"
              aria-label="Send message"
              disabled={!input.trim() || busy || disabled}
              onClick={() => submit(input)}
              whileHover={reduce ? undefined : { y: -1, rotate: -2 }}
              whileTap={reduce ? undefined : { scale: 0.94 }}
              className="grid size-[46px] place-items-center rounded-[15px] bg-primary text-primary-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <ArrowUp className="size-5" strokeWidth={2.5} />
            </motion.button>
          </div>
        </div>
      </div>
    </>
  )
}
