import { useRef, useState } from "react"
import { ArrowUp, Copy, LoaderCircle, Sparkles, X } from "lucide-react"

import { outlookApi } from "@/lib/outlook-api"
import { useI18n } from "@/lib/i18n/context"

const SUGGESTIONS = ["todo", "summary", "urgent"] as const

/** One line until the question wraps; capped by max-h in CSS. */
function grow(field: HTMLTextAreaElement) {
  field.style.height = "auto"
  field.style.height = `${field.scrollHeight}px`
}

type Answer = { answer: string; model: string; provider: string; email_count: number }

/** Composer at the foot of the reader. Each send needs the student's explicit approval (server-enforced). */
export function EmailQuestion({ ids }: { ids: string[] }) {
  const { t } = useI18n()
  const [question, setQuestion] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const target = ids.length === 1 ? t("emails.question.thisEmail") : t("emails.question.selectedEmails", { count: ids.length })
  const ready = !busy && accepted && !!question.trim() && ids.length > 0

  async function ask() {
    if (!ready) return
    setBusy(true); setError(""); setAnswer(null); setCopied(false)
    try {
      setAnswer(await outlookApi<Answer>("/chat", { method: "POST", body: JSON.stringify({ ids, question, accepted }) }))
      setQuestion("")
      if (field.current) field.current.style.height = ""
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("emails.errors.answer")) }
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
            {answer && <span className="font-normal text-muted-foreground">{t("emails.question.onEmails", { count: answer.email_count })}</span>}
            {answer && (
              <span className="ms-auto flex gap-1">
                <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Copy className="size-3" />{copied ? t("emails.question.copied") : t("emails.question.copy")}
                </button>
                <button type="button" aria-label={t("emails.question.closeAnswer")} onClick={() => setAnswer(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
          {busy ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{t("emails.question.reading", { target })}</p>
          ) : answer ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6" dir="auto">{answer.answer}</p>
              <p className="mt-2 text-[11px] text-muted-foreground"><bdi>{answer.provider}</bdi> · <bdi>{answer.model}</bdi></p>
            </>
          ) : null}
        </div>
      )}

      {error && <p role="alert" dir="auto" className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {!question && !answer && !busy && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => { setQuestion(t(`emails.question.suggestions.${suggestion}`)); field.current?.focus() }} className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t(`emails.question.suggestions.${suggestion}`)}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); void ask() }}>
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-background py-1 ps-2.5 pe-1 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={field}
            aria-label={t("emails.question.fieldLabel", { target })}
            placeholder={t("emails.question.placeholder", { target })}
            dir={question ? "auto" : undefined}
            maxLength={2000}
            rows={1}
            value={question}
            disabled={busy}
            onChange={(event) => { setQuestion(event.target.value); grow(event.target) }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask() } }}
            className="max-h-28 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" aria-label={t("emails.question.ask")} disabled={!ready} title={!accepted ? t("emails.question.tickToAllow") : undefined} className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {busy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-3.5" />}
          </button>
        </div>
        <label className="mt-1.5 flex items-start gap-1.5 px-0.5 text-[11px] leading-4 text-muted-foreground">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>{t("emails.question.consent", { target })}</span>
        </label>
      </form>
    </div>
  )
}
