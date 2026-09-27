import { TokenConnection } from "./TokenConnection"
import { useCallback, useEffect, useRef, useState } from "react"

import { ExternalLink, Mail, RefreshCw, ShieldCheck, Star } from "lucide-react"

import { localDay, outlookApi, type MailItem, type OutlookStatus } from "@/lib/outlook-api"

import { MailWorkspace, type MailFilters } from "./MailWorkspace"

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const views = ["important", "today", "review", "followup", "all", "dismissed"] as const

type View = typeof views[number]

const labels: Record<View, string> = { important: "Important", today: "Today", review: "Needs review", followup: "Follow-ups", all: "All mail", dismissed: "Dismissed" }

export function OutlookView({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {

  const [status, setStatus] = useState<OutlookStatus | null>(null)

  const [items, setItems] = useState<MailItem[]>([])

  const [view, setView] = useState<View>(compact ? "today" : "important")

  const [filters, setFilters] = useState<MailFilters>({ q: "", category: "", sort: "newest" })

  const [offset, setOffset] = useState(0)

  const [total, setTotal] = useState(0)

  const [error, setError] = useState("")

  const [busy, setBusy] = useState(false)

  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const generation = useRef(0)

  const pageSize = compact ? 3 : 25

  const load = useCallback(async () => {

    const ticket = ++generation.current

    try {

      const next = await outlookApi<OutlookStatus>("/status")

      if (ticket !== generation.current) return

      setStatus(next)

      if (!next.connected) { setItems([]); setTotal(0); return }

      const page = await outlookApi<{ items: MailItem[]; total: number }>(`/messages?view=${view}&day=${localDay()}&timezone_offset=${new Date().getTimezoneOffset()}&offset=${offset}&limit=${pageSize}&preview=true&q=${encodeURIComponent(filters.q)}&category=${filters.category}&sort=${filters.sort}`)

      if (ticket !== generation.current) return

      setItems(page.items); setTotal(page.total)

      if (offset > 0 && offset >= page.total) setOffset(Math.max(0, Math.floor((page.total - 1) / pageSize) * pageSize))

    } catch (reason) {

      if (ticket === generation.current) {

        setItems([]); setError(reason instanceof Error ? reason.message : "Could not load Outlook")

      }

    }

  }, [view, offset, pageSize, filters])

  useEffect(() => {

    void load()

    const timer = window.setInterval(() => { void load() }, 15000)

    return () => { window.clearInterval(timer); generation.current++ }

  }, [load])

  async function connectDesktop() {
    setBusy(true); setError("")
    try {
      await outlookApi("/desktop/consent", { method: "POST" })
      await outlookApi("/desktop/connect", { method: "POST", body: JSON.stringify({ accepted: true }) })
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect classic Outlook") }
    finally { setBusy(false) }
  }

  async function action(path: string, method: string, body?: object) {

    generation.current++

    setBusy(true); setError("")

    try {

      await outlookApi(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      await load()
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Outlook action failed"); return false }
    finally { setBusy(false) }

  }

  if (compact && onOpen) return <section aria-label="Today in your mail" className="rounded-3xl border border-border bg-background p-5 shadow-sm">
    <div className="flex items-center gap-3"><Mail className="size-5 shrink-0 text-muted-foreground" /><h2 className="text-base font-semibold">Today in your mail</h2>{status?.connected && <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{total}</span>}</div>
    {!status ? <p className="mt-4 text-sm text-muted-foreground">Loading mail…</p> : !status.connected ? <p className="mt-3 text-sm leading-6 text-muted-foreground">Connect Outlook to see today’s messages and follow-ups here.</p> : <div className="mt-3 divide-y divide-border">{items.map(item => <button key={item.id} className="block w-full py-3 text-left hover:text-primary" onClick={onOpen}><span className="block truncate text-xs text-muted-foreground">{item.sender}</span><span className="mt-1 line-clamp-2 text-sm font-medium">{item.subject}</span>{item.due_date && <span className="mt-1 block text-xs text-muted-foreground">Follow up {item.due_date}</span>}</button>)}{!items.length && <p className="py-3 text-sm text-muted-foreground">No messages or follow-ups for today.</p>}</div>}
    {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    <button className={`${button} mt-4 w-full`} onClick={onOpen}>{status?.connected ? "View all emails" : "Connect Outlook"}</button>
  </section>

  return <section className={compact ? "rounded-3xl border border-border bg-background p-5" : "mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-8"} aria-label="University Outlook">

    <div className="flex flex-wrap items-center justify-between gap-4">

      <div className="flex items-center gap-3"><span className="rounded-2xl bg-primary/10 p-3 text-primary"><Mail className="size-5" /></span><div>

        <h1 className="text-xl font-semibold tracking-tight">{compact ? "Today in your mail" : "Emails"}</h1>

        <p className="mt-1 text-sm text-muted-foreground">{status?.connected ? status.account : "Your university updates, in one place."}</p>

      </div></div>

      {compact && onOpen ? <button className={button} onClick={onOpen}>Open Outlook</button> : status?.connected ? <div className="flex flex-wrap gap-2">

        <button className={button} disabled={busy || status.status === "running"} onClick={() => void action("/sync", "POST")}><RefreshCw className="size-4" />Sync now</button>

        <button className={button} disabled={busy} onClick={() => void action("/preferences", "PATCH", { auto_sync: !status.auto_sync })}>{status.auto_sync ? "Pause sync" : "Resume sync"}</button>

        <button className={button} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>

      </div> : null}

    </div>

    {error && <p role="alert" className="my-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

    {!status ? <p className="py-6 text-sm text-muted-foreground">Loading Outlook connection…</p> : !status.connected ? <div className="mt-5 space-y-4">
      <div className="rounded-2xl border border-border p-5">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5" />Classic Outlook on this computer</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Read the default mailbox signed in to classic Outlook on Windows. Waypoint classifies emails locally with Laya and keeps cleaned text for 30 days. It does not send, edit or delete Outlook messages.</p>
        {status.desktop_available ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-muted/50 p-4 text-sm"><input type="checkbox" aria-label="Allow classic Outlook mailbox access" checked={busy} disabled={busy} onChange={event => { if (event.target.checked) void connectDesktop() }} /><span>{busy ? "Connecting to classic Outlook…" : "I allow Waypoint to read and locally classify my classic Outlook mailbox."}</span></label> : <p className="mt-3 text-sm text-muted-foreground">Requires classic Outlook installed on Windows and Waypoint setup completed. This method is unavailable on macOS, in Docker, and with new Outlook.</p>}
      </div>
      <TokenConnection available={!!status.token_available} onConnected={load} />
      <p className="text-sm text-muted-foreground">Mailbox access belongs to your private connection, independently of the demo profile. Email Q&A sends only messages you explicitly select and approve. Mail is never shared with teammates.</p>
    </div> : <>

      <p aria-live="polite" className="mt-4 text-xs text-muted-foreground">{status.status === "running" || status.status === "queued" ? `Sync ${status.status} · ${status.processed ?? 0} messages classified` : status.last_sync ? `Last completed sync ${new Date(status.last_sync * 1000).toLocaleString()}` : "First sync has not completed"} · {status.auto_sync ? "Automatic sync every 15 minutes while Waypoint runs" : "Automatic sync paused"}</p>

      <label className="mt-4 flex items-start gap-3 rounded-xl border border-border p-3 text-sm"><input type="checkbox" className="mt-1" checked={!!status.coach_access} disabled={busy} onChange={event => void action("/coach-access", "PATCH", { accepted: event.target.checked })} /><span>Allow Coach to search and read my synced emails in this browser's Coach chats.<span className="mt-1 block text-xs text-muted-foreground">Matching email text may be sent to configured AI providers, including fallbacks. Coach and provider history may retain it. Uncheck to stop future access; disconnect also revokes access.</span></span></label>
      {status.jev_available ? <label className="mt-3 flex items-start gap-3 rounded-xl border border-border p-3 text-sm"><input type="checkbox" className="mt-1" checked={!!status.jev_access} disabled={busy} onChange={event => void action("/jev-access", "PATCH", { accepted: event.target.checked })} /><span>Let the Jev decision layer review newly synced emails.<span className="mt-1 block text-xs text-muted-foreground">Each new or changed email's subject and cleaned text is sent to TypeSafe (Jev) after best-effort redaction. Only its answers are stored in Waypoint, not the email text. The provider may retain what it receives. Uncheck to stop future sends; disconnect also turns this off.</span></span></label> : null}

      {status.worker_enabled === false && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">Sync worker is disabled. Enable OUTLOOK_SYNC_ENABLED on the API server and restart it.</p>}

      {status.error && <div role="status" className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm">{status.error}</div>}

      {status.status === "reconnect" && status.provider === "token" && <TokenConnection available={!!status.token_available} onConnected={load} />}

      {confirmDisconnect && <div role="alert" className="my-4 rounded-xl border border-border p-4"><p className="text-sm">Disconnect and delete cached mail, labels and saved dates from Waypoint? Your Outlook mailbox is unchanged. Microsoft consent can also be revoked in your Microsoft account.</p><div className="mt-3 flex gap-2"><button className={button} disabled={busy} onClick={() => { setConfirmDisconnect(false); void action("/connection", "DELETE") }}>Disconnect and delete</button><button className={button} onClick={() => setConfirmDisconnect(false)}>Cancel</button></div></div>}

      {!compact && <><nav aria-label="Mail views" className="mt-5 flex flex-wrap gap-2">{views.map(tab => <button key={tab} className={`${button} ${view === tab ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`} aria-pressed={view === tab} onClick={() => { setView(tab); setOffset(0); setError("") }}>{labels[tab]}</button>)}</nav>

        <p className="mt-3 text-sm text-muted-foreground">Laya labels are suggestions. Important includes your pinned messages and model suggestions. Today includes mail received today in your timezone, plus dates you set. Arabic and uncertain messages stay available under Needs review.</p></>}

      {!compact ? <MailWorkspace key={view} items={items} total={total} busy={busy} filters={filters} onFilters={next => { setFilters(next); setOffset(0) }} offset={offset} pageSize={pageSize} onPage={setOffset} onAction={action} dismissed={view === "dismissed"} /> : <div className="mt-4 space-y-3">{items.map(item => <article key={item.id} className="rounded-2xl border border-border p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{item.sender} · {item.received ? new Date(item.received).toLocaleDateString() : "Unknown date"}</p><h2 className="mt-1 break-words font-semibold">{item.subject}</h2></div>{item.pinned && <Star aria-label="Pinned" className="size-4 shrink-0 fill-amber-500 text-amber-500" />}</div>

        {item.due_date && <p className="mt-2 text-xs text-muted-foreground">Follow up {item.due_date}</p>}

        <div className="mt-3 flex gap-2">{onOpen && <button className={button} onClick={onOpen}>Read in Emails</button>}{item.web_url && <a className={button} href={item.web_url} target="_blank" rel="noopener noreferrer">Outlook<ExternalLink className="size-3" /></a>}</div>

      </article>)}{!items.length && <p className="py-6 text-center text-sm text-muted-foreground">No university mail for today yet.</p>}</div>}

    </>}

  </section>

}
