import { useState } from "react"
import { hermesRequestParts } from "@/lib/farq-api"
import { outlookApi } from "@/lib/outlook-api"

export function EmailQuestion({ ids }: { ids: string[] }) {
  const [question, setQuestion] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ answer: string; model: string; provider: string; email_count: number } | null>(null)
  const [error, setError] = useState("")
  async function ask() {
    setBusy(true); setError(""); setAnswer(null)
    const { body, headers } = hermesRequestParts()
    try {
      setAnswer(await outlookApi("/chat", { method: "POST", headers, body: JSON.stringify({ ...body, ids, question, accepted }) }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not answer this question") }
    finally { setBusy(false) }
  }
  return <details className="border-t border-border bg-muted/15 p-4 sm:p-5">
    <summary className="cursor-pointer text-sm font-semibold">Ask about {ids.length === 1 ? "this email" : `${ids.length} selected emails`}</summary>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Coach answers from the selected messages using the shared Hermes gateway. Up to 25 emails and 24,000 characters; larger selections are rejected without cutting the text. Coach shares its tools and memory; Hermes and AI providers may retain request history.</p>
    <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void ask() }}>
      <textarea aria-label="Question about selected emails" placeholder="What do I need to do, and by when?" maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} className="min-h-20 w-full rounded-xl border border-border bg-background p-3 text-sm" />
      <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>Send these emails and my question to the AI providers configured in Settings, including fallback providers, for this answer.</span></label>
      <button disabled={busy || !accepted || !question.trim() || !ids.length} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Reading selected emails…" : "Ask Hermes"}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {answer && <div className="mt-4 rounded-xl border border-border bg-background p-4" role="status"><p className="whitespace-pre-wrap text-sm leading-6" dir="auto">{answer.answer}</p><p className="mt-3 text-xs text-muted-foreground">{answer.email_count} emails · {answer.provider} / {answer.model}</p></div>}
  </details>
}
