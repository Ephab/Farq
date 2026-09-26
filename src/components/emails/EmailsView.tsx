"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, LogOut, Mail, PlugZap, Send } from "lucide-react"
import { api, getCurrentStudentId, hermesRequestParts } from "@/lib/farq-api"

interface OutlookEmail {
  id: string
  subject: string
  sender: { name: string; address: string }
  received: string
  preview: string
  body: string
  is_read: boolean
}

interface OutlookStatus {
  connected: boolean
  email: string
  configured: boolean
}

interface DeviceStart {
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
  message: string
}

export function EmailsView() {
  const studentId = getCurrentStudentId()
  const [status, setStatus] = useState<OutlookStatus | null>(null)
  const [device, setDevice] = useState<DeviceStart | null>(null)
  const [count, setCount] = useState(10)
  const [emails, setEmails] = useState<OutlookEmail[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerMeta, setAnswerMeta] = useState<string | null>(null)
  const [busy, setBusy] = useState<"idle" | "connect" | "pull" | "ask" | "token">("idle")
  const [pastedToken, setPastedToken] = useState("")
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  const refreshStatus = useCallback(async () => {
    const [config, state] = await Promise.all([
      api<{ configured: boolean }>("/api/outlook/config").catch(() => ({ configured: false })),
      api<{ connected: boolean; email: string }>(`/api/students/${studentId}/outlook/status`).catch(() => ({ connected: false, email: "" })),
    ])
    setStatus({ connected: state.connected, email: state.email, configured: config.configured })
  }, [studentId])

  useEffect(() => {
    refreshStatus().catch(() => undefined)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [refreshStatus])

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = null
  }

  const connect = async () => {
    setBusy("connect")
    setError(null)
    try {
      const started = await api<DeviceStart>(`/api/students/${studentId}/outlook/device/start`, { method: "POST" })
      setDevice(started)
      const target = started.verification_uri_complete || started.verification_uri
      window.open(target, "_blank", "noopener")
      stopPolling()
      pollRef.current = window.setInterval(async () => {
        try {
          const next = await api<{ connected: boolean; email?: string }>(`/api/students/${studentId}/outlook/device/poll`, { method: "POST" })
          if (next.connected) {
            stopPolling()
            setDevice(null)
            setBusy("idle")
            await refreshStatus()
          }
        } catch (reason) {
          stopPolling()
          setBusy("idle")
          setError(reason instanceof Error ? reason.message : "Sign-in check failed")
        }
      }, Math.max(started.interval, 2) * 1000)
    } catch (reason) {
      setBusy("idle")
      setError(reason instanceof Error ? reason.message : "Could not start sign-in")
    }
  }

  const pull = async () => {
    const n = Math.min(25, Math.max(1, Math.floor(count) || 10))
    setCount(n)
    setBusy("pull")
    setError(null)
    try {
      const result = await api<{ emails: OutlookEmail[] }>(`/api/students/${studentId}/outlook/emails?limit=${n}`)
      setEmails(result.emails)
      setExpanded(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read emails")
    } finally {
      setBusy("idle")
    }
  }

  const ask = async () => {
    const text = question.trim()
    if (!text) return
    setBusy("ask")
    setError(null)
    setAnswer(null)
    setAnswerMeta(null)
    try {
      const { body, headers } = hermesRequestParts()
      const result = await api<{ answer: string; email_count: number; model: string }>(
        `/api/students/${studentId}/outlook/chat`,
        { method: "POST", body: JSON.stringify({ question: text, limit: Math.min(25, Math.max(1, count)), ...body }), headers },
      )
      setAnswer(result.answer)
      setAnswerMeta(`Answered from ${result.email_count} email${result.email_count === 1 ? "" : "s"} · ${result.model}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hermes could not answer")
    } finally {
      setBusy("idle")
    }
  }

  const disconnect = async () => {
    setError(null)
    try {
      await api(`/api/students/${studentId}/outlook/disconnect`, { method: "POST" })
      stopPolling()
      setDevice(null)
      setEmails([])
      setAnswer(null)
      setPastedToken("")
      await refreshStatus()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not disconnect")
    }
  }

  const saveToken = async () => {
    const token = pastedToken.trim()
    if (token.length < 16) {
      setError("Paste the full access token first.")
      return
    }
    setBusy("token")
    setError(null)
    try {
      await api(`/api/students/${studentId}/outlook/token`, { method: "POST", body: JSON.stringify({ access_token: token }) })
      setPastedToken("")
      setShowToken(false)
      await refreshStatus()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That token did not work")
    } finally {
      setBusy("idle")
    }
  }

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Emails</h1>
            <p className="mt-2 max-w-[62ch] text-[15px] text-muted-foreground">
              Read-only Outlook snapshot for this chat only. Nothing here becomes a fact, evidence, or Coach memory.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status?.connected ? (
              <>
                <span className="inline-flex min-h-9 items-center rounded-full bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {status.email || "Connected"}
                </span>
                <button type="button" onClick={() => void disconnect()} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-xs font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <LogOut className="size-3.5" />Disconnect
                </button>
              </>
            ) : (
              <button type="button" disabled={busy === "connect"} onClick={() => void connect()} className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                {busy === "connect" ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                {busy === "connect" ? "Waiting for approval…" : "Connect Outlook"}
              </button>
            )}
          </div>
        </div>

        {status && !status.configured && !status.connected ? (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="font-semibold">No Entra app needed to try this now.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Open Graph Explorer, sign in with your personal Outlook, consent to Mail.Read, copy the access token, and paste it below. It lasts about an hour and stays on the server.
            </p>
            <button type="button" onClick={() => setShowToken(!showToken)} className="mt-2 inline-flex h-9 items-center rounded-full border border-border bg-background px-3.5 text-xs font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              {showToken ? "Hide token field" : "Use a temporary token instead"}
            </button>
            {showToken ? (
              <div className="mt-3 grid gap-2">
                <textarea
                  value={pastedToken}
                  onChange={(event) => setPastedToken(event.target.value)}
                  placeholder="Paste access token…"
                  aria-label="Temporary Outlook access token"
                  rows={3}
                  className="w-full rounded-2xl border border-border bg-background p-3 font-mono text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                />
                <div>
                  <button type="button" disabled={busy === "token" || pastedToken.trim().length < 16} onClick={() => void saveToken()} className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                    {busy === "token" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    {busy === "token" ? "Checking…" : "Save token"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {device ? (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="font-semibold">Approve read-only access in the tab that opened.</p>
            <p className="mt-1 text-muted-foreground">If it didn't open, go to {device.verification_uri} and enter code:</p>
            <p className="mt-2 inline-block rounded-xl bg-muted px-4 py-2 font-mono text-lg font-bold tracking-widest">{device.user_code}</p>
          </div>
        ) : null}

        {error ? <p className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">{error}</p> : null}

        <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="email-count" className="text-sm font-semibold">Latest emails</label>
            <input
              id="email-count"
              type="number"
              min={1}
              max={25}
              value={count}
              disabled={!status?.connected || busy === "pull"}
              onChange={(event) => setCount(Number(event.target.value))}
              className="h-10 w-20 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button type="button" disabled={!status?.connected || busy === "pull"} onClick={() => void pull()} className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
              {busy === "pull" ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}
              {busy === "pull" ? "Reading…" : "Pull"}
            </button>
            {!status?.connected ? <span className="text-xs text-muted-foreground">Connect Outlook first.</span> : null}
          </div>

          <div className="mt-4 grid gap-2">
            {emails.length === 0 ? (
              <p className="rounded-2xl bg-muted/50 p-4 text-[13px] text-muted-foreground">No emails pulled yet. Choose how many to read, then Pull.</p>
            ) : emails.map((email) => {
              const open = expanded === email.id
              return (
                <div key={email.id} className="rounded-2xl border border-border bg-background p-3">
                  <button type="button" onClick={() => setExpanded(open ? null : email.id)} className="flex w-full items-start justify-between gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{email.subject}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {email.sender.name || email.sender.address} · {email.received.slice(0, 10)}
                      </span>
                      {!open ? <span className="mt-1 block text-xs text-muted-foreground">{email.preview}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
                  </button>
                  {open ? <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{email.body || email.preview}</p> : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-label="Ask Hermes about these emails">
          <h2 className="text-[17px] font-semibold tracking-tight">Ask Hermes about these emails</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Answered on a throwaway session — the Coach thread never sees this.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && question.trim() && busy === "idle") void ask() }}
              placeholder="e.g. What college deadlines are in my latest emails?"
              aria-label="Question about your emails"
              className="h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
            <button type="button" disabled={!question.trim() || busy === "ask" || !status?.connected} onClick={() => void ask()} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
              {busy === "ask" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {busy === "ask" ? "Asking…" : "Ask"}
            </button>
          </div>
          {answer ? (
            <div className="mt-4 rounded-2xl bg-muted/50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
              {answerMeta ? <p className="mt-2 text-xs text-muted-foreground">{answerMeta}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
