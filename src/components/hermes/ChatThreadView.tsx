"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, Copy, LoaderCircle, PencilLine, RefreshCw, RotateCcw, Send } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { splitOptions, type ChatMessage } from "@/components/hermes/use-hermes-chat"

interface ChatThreadViewProps {
  messages: ChatMessage[]
  busy: boolean
  stage: string
  error: string | null
  onSend: (text: string) => void
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
}

/** Message list + composer shared by Hermes Coach and the onboarding chat. */
export function ChatThreadView({ messages, busy, stage, error, onSend, onRetry, onEditResend, placeholder, disabled, empty, afterMessages, draft }: ChatThreadViewProps) {
  const [input, setInput] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, stage])
  useEffect(() => { if (draft) setInput(draft) }, [draft])
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  const isLast = (message: ChatMessage) => message.id === lastAssistant?.id && messages[messages.length - 1]?.id === message.id

  const submit = (text: string) => {
    if (!text.trim() || busy || disabled) return
    onSend(text)
    setInput("")
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-3xl space-y-5">
        {messages.length === 0 ? empty : null}
        {messages.map((message, index) => {
          const { text, options } = message.role === "assistant" ? splitOptions(message.content) : { text: message.content, options: [] }
          const prompt = message.role === "assistant" ? promptFor(index) : null
          const copied = copiedId === message.id
          return (
            <div key={message.id} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              {message.role === "user" && editingId === message.id ? (
                <div className="w-full max-w-[88%] rounded-2xl border border-primary/50 bg-card p-2 sm:max-w-[76%]">
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveEdit(message.id) } if (event.key === "Escape") setEditingId(null) }} rows={3} autoFocus className="max-h-40 min-h-16 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none" />
                  <div className="flex justify-end gap-1.5 px-1 pb-1">
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancel</button>
                    <button type="button" disabled={!editDraft.trim() || busy || disabled} onClick={() => saveEdit(message.id)} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40">Resend</button>
                  </div>
                </div>
              ) : (
                <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[76%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-card"}`}>{message.role === "assistant" ? <MarkdownText text={text} /> : <p className="whitespace-pre-wrap">{text}</p>}</div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button type="button" aria-label={message.role === "user" ? "Copy prompt" : "Copy output"} onClick={() => void copyText(message.id, text)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}
                </button>
                {message.role === "user" ? (
                  <button type="button" aria-label="Edit prompt and resend" disabled={busy || disabled || editingId !== null} onClick={() => editPrompt(message)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                    <PencilLine className="size-3" />Edit & resend
                  </button>
                ) : prompt ? (
                  <button type="button" aria-label="Regenerate from prompt" disabled={busy || disabled} onClick={() => submit(prompt)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                    <RotateCcw className="size-3" />Regenerate
                  </button>
                ) : null}
              </div>
              {options.length > 0 && isLast(message) ? (
                <div className="mt-2 flex max-w-[88%] flex-wrap gap-2">
                  {options.map((option) => <button key={option} type="button" disabled={busy || disabled} onClick={() => submit(option)} className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary/10 disabled:opacity-40">{option}</button>)}
                </div>
              ) : null}
            </div>
          )
        })}
        {afterMessages}
        {busy ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{stage || "Hermes is working"}</div> : null}
        {error ? <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span><button type="button" aria-label="Retry" onClick={onRetry}><RefreshCw className="size-4" /></button></div> : null}<div ref={bottomRef} />
      </div></div>
      <div className="border-t border-border p-3 sm:p-5"><div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring"><textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(input) } }} placeholder={placeholder} rows={2} className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" /><button type="button" aria-label="Send" disabled={!input.trim() || busy || disabled} onClick={() => submit(input)} className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="size-4" /></button></div></div>
    </>
  )
}
