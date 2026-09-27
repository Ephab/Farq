import { PersonalConnection } from "./PersonalConnection"
import { useCallback, useEffect, useRef, useState } from "react"

import { ExternalLink, LoaderCircle, Mail, RefreshCw, ShieldCheck, Star } from "lucide-react"

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

  const [connecting, setConnecting] = useState(false)

  const [desktopConsent, setDesktopConsent] = useState(false)

  const [pairingCode, setPairingCode] = useState("")

  const [accepted, setAccepted] = useState(false)

  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const popup = useRef<Window | null>(null)

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



  useEffect(() => {

    const receive = (event: MessageEvent) => {

      if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.type !== "farq-outlook") return

      setConnecting(false)

      if (event.data.status === "failed") setError("Microsoft sign-in was cancelled or failed. Your university may require administrator approval.")

      void load()

    }

    window.addEventListener("message", receive)

    return () => window.removeEventListener("message", receive)

  }, [load])



  useEffect(() => {

    if (!connecting) return

    const start = Date.now()

    const timer = window.setInterval(() => {

      if (popup.current?.closed || Date.now() - start > 600000) {

        setConnecting(false); void load()

      }

    }, 1000)

    return () => window.clearInterval(timer)

  }, [connecting, load])



  async function connect() {

    if (status?.provider === "desktop") { setDesktopConsent(true); return }

    setError(""); setConnecting(true)

    popup.current = window.open("about:blank", "farq-outlook", "width=560,height=720")

    try {

      const result = await outlookApi<{ url: string }>("/authorize", { method: "POST" })

      if (popup.current && !popup.current.closed) popup.current.location.href = result.url

      else window.location.assign(result.url)

    } catch (reason) {

      popup.current?.close(); setConnecting(false)

      setError(reason instanceof Error ? reason.message : "Could not start sign-in")

    }

  }



  async function connectDesktop() {

    setBusy(true); setError("")

    try {

      await outlookApi("/desktop/connect", { method: "POST", body: JSON.stringify({ pairing_code: pairingCode, accepted }) })

      setPairingCode(""); setDesktopConsent(false); setAccepted(false)

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

    {!compact && status && !status.connected && <PersonalConnection onConnected={load} />}

    {error && <p role="alert" className="my-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

    {desktopConsent && <div role="dialog" aria-modal="false" aria-label="Connect classic Outlook" className="my-4 space-y-3 rounded-2xl border border-border p-5">

      <h2 className="font-semibold">Connect classic Outlook on this computer</h2>

      <p className="text-sm">Farq will read mail folders in Outlook's default mailbox while the app runs. Check that your university mailbox is the default in classic Outlook. No Entra registration is needed. New Outlook, macOS and Docker are not supported by this connection.</p>

      <p className="text-sm">Laya classifies locally. Farq keeps the complete cleaned, redacted email text for 30 days and does not send, edit or delete Outlook messages. Outlook may ask you to approve access.</p>

      <label className="block text-sm">Local pairing code<input type="password" autoComplete="off" value={pairingCode} onChange={event => setPairingCode(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" /></label>

      <p className="text-xs text-muted-foreground">Use the code printed in the terminal when Farq starts.</p>

      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I allow Farq to read and locally classify this Outlook mailbox.</label>

      <div className="flex gap-2"><button className={button} disabled={busy || !accepted || !pairingCode.trim()} onClick={() => void connectDesktop()}>{busy ? "Connecting…" : "Allow and connect"}</button><button className={button} disabled={busy} onClick={() => { setDesktopConsent(false); setPairingCode(""); setAccepted(false) }}>Cancel</button></div>

    </div>}

    {!status ? <p className="py-6 text-sm text-muted-foreground">Loading Outlook connection…</p> : !status.connected ? <div className="mt-5 rounded-2xl bg-muted/50 p-5">

      <div className="flex gap-2"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><p className="max-w-2xl text-sm leading-6">{status.provider === "desktop" ? "Connect the default mailbox already signed in to classic Outlook on this Windows computer. No Entra registration is needed." : "Connect through Microsoft's sign-in window."} Farq reads mail and classifies text locally with Laya. It stores complete cleaned, redacted email text for 30 days. This integration does not send or change your emails.</p></div>

      {!compact && <p className="mt-3 text-sm text-muted-foreground">Mailbox access belongs to your private connection session, independently of the demo profile switcher. Automatic sync stays local. Email Q&A shares only the messages you explicitly select and approve; nothing is shared with teammates.</p>}

      {!status.configured && <p className="mt-3 text-sm text-muted-foreground">{status.error}</p>}

      <button className={`${button} mt-4 bg-primary text-primary-foreground hover:bg-primary/90`} disabled={!status.configured || connecting} onClick={() => void connect()}>{connecting ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}{connecting ? "Waiting for Microsoft…" : "Connect Outlook"}</button>

    </div> : <>

      <p aria-live="polite" className="mt-4 text-xs text-muted-foreground">{status.status === "running" || status.status === "queued" ? `Sync ${status.status} · ${status.processed ?? 0} messages classified` : status.last_sync ? `Last completed sync ${new Date(status.last_sync * 1000).toLocaleString()}` : "First sync has not completed"} · {status.auto_sync ? "Automatic sync every 15 minutes while Farq runs" : "Automatic sync paused"}</p>

      {status.worker_enabled === false && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">Sync worker is disabled. Enable OUTLOOK_SYNC_ENABLED on the API server and restart it.</p>}

      {status.error && <div role="status" className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm">{status.error}{status.status === "reconnect" && <button className={`${button} ml-3`} onClick={() => void connect()}>Sign in again</button>}</div>}

      {confirmDisconnect && <div role="alert" className="my-4 rounded-xl border border-border p-4"><p className="text-sm">Disconnect and delete cached mail, labels and saved dates from Farq? Your Outlook mailbox is unchanged. Microsoft consent can also be revoked in your Microsoft account.</p><div className="mt-3 flex gap-2"><button className={button} disabled={busy} onClick={() => { setConfirmDisconnect(false); void action("/connection", "DELETE") }}>Disconnect and delete</button><button className={button} onClick={() => setConfirmDisconnect(false)}>Cancel</button></div></div>}

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
