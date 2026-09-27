import { useRef, useState } from "react"
import { ArrowUp, Copy, LoaderCircle, Sparkles, X } from "lucide-react"

import { hermesRequestParts } from "@/lib/waypoint-api"
import { outlookApi } from "@/lib/outlook-api"

const SUGGESTIONS = ["What do I need to do, and by when?", "Summarize this in two lines", "Is anything here urgent?"]

/** One line until the question wraps; capped by max-h in CSS. */
function grow(field: HTMLTextAreaElement) {
  field.style.height = "auto"
  field.style.height = `${field.scrollHeight}px`
}

type Answer = { answer: string; model: string; provider: string; email_count: number }

/** Composer at the foot of the reader. Each send needs the student's explicit approval (server-enforced). */
export function EmailQuestion({ ids }: { ids: string[] }) {
  const [question, setQuestion] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const target = ids.length === 1 ? "this email" : `${ids.length} selected emails`
  const ready = !busy && accepted && !!question.trim() && ids.length > 0

  async function ask() {
    if (!ready) return
    setBusy(true); setError(""); setAnswer(null); setCopied(false)
    const { body, headers } = hermesRequestParts()
    try {
      setAnswer(await outlookApi<Answer>("/chat", { method: "POST", headers, body: JSON.stringify({ ...body, ids, question, accepted }) }))
      setQuestion("")
      if (field.current) field.current.style.height = ""
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Hermes couldn't answer. Try again.") }
    finally { setBusy(false) }
  }

  async function copy() {
    if (!answer) return
    try { await navigator.clipboard.writeText(answer.answer); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2.5 sm:px-4">
      {(answer || busy) && (
        <div role="status" aria-live="polite" className="mb-3 max-h-64 overflow-y-auto rounded-xl border border-border bg-background p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
            Hermes
            {answer && <span className="font-normal text-muted-foreground">on {answer.email_count === 1 ? "1 email" : `${answer.email_count} emails`}</span>}
            {answer && (
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Copy className="size-3" />{copied ? "Copied" : "Copy"}
                </button>
                <button type="button" aria-label="Close answer" onClick={() => setAnswer(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
          {busy ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Reading {target}…</p>
          ) : answer ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6" dir="auto">{answer.answer}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{answer.provider} · {answer.model}</p>
            </>
          ) : null}
        </div>
      )}

      {error && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {!question && !answer && !busy && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); field.current?.focus() }} className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); void ask() }}>
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-background py-1 pl-2.5 pr-1 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={field}
            aria-label={`Question about ${target}`}
            placeholder={`Ask Hermes about ${target}…`}
            maxLength={2000}
            rows={1}
            value={question}
            disabled={busy}
            onChange={(event) => { setQuestion(event.target.value); grow(event.target) }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask() } }}
            className="max-h-28 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" aria-label="Ask Hermes" disabled={!ready} title={!accepted ? "Tick the box below to allow sending" : undefined} className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {busy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-3.5" />}
          </button>
        </div>
        <label className="mt-1.5 flex items-start gap-1.5 px-0.5 text-[11px] leading-4 text-muted-foreground">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>Send {target} and my question to my AI providers. They may keep request history.</span>
        </label>
      </form>
    </div>
  )
}
