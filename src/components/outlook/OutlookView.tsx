import { TokenConnection } from "./TokenConnection"
import { MailboxRail } from "./MailboxRail"
import { useCallback, useEffect, useRef, useState } from "react"

import { Mail, ShieldCheck } from "lucide-react"

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

  // The app bar already names the page and the rail shows the account, so the heading is for screen readers only.
  const header = <h1 className="sr-only">Emails</h1>

  const errorBanner = error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>

  if (!status) return <section aria-label="University Outlook" className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-8">{header}<p className="text-sm text-muted-foreground">Loading Outlook connection…</p></section>

  // Rail placement follows the section's own width (container query), so the view also fits when embedded in onboarding.
  const layout = "grid items-start gap-5 @5xl:grid-cols-[minmax(0,1fr)_300px]"

  if (!status.connected) return <section aria-label="University Outlook" className="@container mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-8">
    {header}
    {errorBanner}
    <div className={layout}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-border p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5" />Classic Outlook on this computer</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Reads the mailbox signed in to classic Outlook on Windows. Waypoint never sends, edits or deletes your messages.</p>
          {status.desktop_available ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-muted/50 p-4 text-sm"><input type="checkbox" aria-label="Allow classic Outlook mailbox access" checked={busy} disabled={busy} onChange={event => { if (event.target.checked) void connectDesktop() }} /><span>{busy ? "Connecting to classic Outlook…" : "I allow Waypoint to read and locally classify my classic Outlook mailbox."}</span></label> : <p className="mt-3 text-sm text-muted-foreground">Needs classic Outlook on Windows and a finished Waypoint setup. Not available on macOS, in Docker or with new Outlook. Use a Graph token instead.</p>}
        </div>
        <TokenConnection available={!!status.token_available} onConnected={load} />
      </div>
      <aside aria-label="What happens to your mail" className="rounded-2xl border border-border p-4 text-xs leading-5 text-muted-foreground @5xl:sticky @5xl:top-4">
        <h2 className="text-sm font-semibold text-foreground">What happens to your mail</h2>
        <ul className="mt-2 space-y-2">
          <li>Laya classifies it on this computer. You can pick a cloud classifier after connecting.</li>
          <li>Cleaned text stays in Waypoint for 30 days; attachments aren't imported.</li>
          <li>Email Q&A only sends messages you select and approve.</li>
          <li>The connection is yours alone. Teammates and the demo profile never see your mail.</li>
        </ul>
      </aside>
    </div>
  </section>

  return <section aria-label="University Outlook" className="@container mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-8">
    {header}
    {errorBanner}
    <div className={layout}>
      <div className="min-w-0 space-y-3">
        <nav aria-label="Mail views" className="flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5 [scrollbar-width:none] sm:w-fit">
          {views.map(tab => <button key={tab} className={`h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} aria-pressed={view === tab} onClick={() => { setView(tab); setOffset(0); setError("") }}>{labels[tab]}</button>)}
        </nav>
        <MailWorkspace key={view} items={items} total={total} busy={busy} filters={filters} onFilters={next => { setFilters(next); setOffset(0) }} offset={offset} pageSize={pageSize} onPage={setOffset} onAction={action} dismissed={view === "dismissed"} classifier={status.classifiers?.find(engine => engine.id === (status.classifier ?? "laya"))} />
      </div>
      <MailboxRail status={status} busy={busy} onAction={action} onReconnected={load} />
    </div>
  </section>
}
