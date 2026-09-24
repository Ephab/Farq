"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { LoaderCircle, RefreshCw, Send } from "lucide-react"
import { splitOptions, type ChatMessage } from "@/components/hermes/use-hermes-chat"

interface ChatThreadViewProps {
  messages: ChatMessage[]
  busy: boolean
  stage: string
  error: string | null
  onSend: (text: string) => void
  onRetry: () => void
  placeholder: string
  disabled?: boolean
  empty?: ReactNode
  /** Prefill (not send) the composer, e.g. from suggestion chips in `empty`. */
  draft?: string
}

/** Message list + composer shared by Hermes Coach and the onboarding chat. */
export function ChatThreadView({ messages, busy, stage, error, onSend, onRetry, placeholder, disabled, empty, draft }: ChatThreadViewProps) {
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, stage])
  useEffect(() => { if (draft) setInput(draft) }, [draft])
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  const isLast = (message: ChatMessage) => message.id === lastAssistant?.id && messages[messages.length - 1]?.id === message.id

  const submit = (text: string) => {
    if (!text.trim() || busy || disabled) return
    onSend(text)
    setInput("")
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-3xl space-y-5">
        {messages.length === 0 ? empty : null}
        {messages.map((message) => {
          const { text, options } = message.role === "assistant" ? splitOptions(message.content) : { text: message.content, options: [] }
          return (
            <div key={message.id} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[76%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-card"}`}><p className="whitespace-pre-wrap">{text}</p></div>
              {options.length > 0 && isLast(message) ? (
                <div className="mt-2 flex max-w-[88%] flex-wrap gap-2">
                  {options.map((option) => <button key={option} type="button" disabled={busy || disabled} onClick={() => submit(option)} className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary/10 disabled:opacity-40">{option}</button>)}
                </div>
              ) : null}
            </div>
          )
        })}
        {busy ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{stage || "Hermes is working"}</div> : null}
        {error ? <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span><button type="button" aria-label="Retry" onClick={onRetry}><RefreshCw className="size-4" /></button></div> : null}<div ref={bottomRef} />
      </div></div>
      <div className="border-t border-border p-3 sm:p-5"><div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(input) } }} placeholder={placeholder} rows={2} className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" /><button type="button" aria-label="Send" disabled={!input.trim() || busy || disabled} onClick={() => submit(input)} className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="size-4" /></button></div></div>
    </>
  )
}
