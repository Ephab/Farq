import { TokenConnection } from "./TokenConnection"
import { MailboxRail } from "./MailboxRail"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { Mail, Search, ShieldCheck, X } from "lucide-react"

import { localDay, outlookApi, type MailItem, type OutlookStatus } from "@/lib/outlook-api"
import { useI18n } from "@/lib/i18n/context"

import { MailWorkspace, categoryKey, dueDay, mailCategories, type MailFilters } from "./MailWorkspace"

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const selectCls = "h-8 shrink-0 rounded-lg border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const views = ["important", "today", "review", "followup", "all", "dismissed"] as const

type View = typeof views[number]


export function OutlookView({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const { t, fmt } = useI18n()

  const [status, setStatus] = useState<OutlookStatus | null>(null)

  const [items, setItems] = useState<MailItem[]>([])

  const [view, setView] = useState<View>(compact ? "today" : "important")

  const [filters, setFilters] = useState<MailFilters>({ q: "", category: "", sort: "newest" })

  const [draft, setDraft] = useState("")

  useEffect(() => { setDraft(filters.q) }, [filters.q])

  // Sliding pill behind the active tab: measured from the live buttons so it
  // glides to the right size and position whenever the view changes. Re-measured
  // after paint, on resize, and when fonts settle, so the box is there on first load.
  const navRef = useRef<HTMLElement>(null)
  const tabRefs = useRef(new Map<View, HTMLButtonElement>())
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false })
  useLayoutEffect(() => {
    const measure = () => {
      const host = navRef.current
      const active = tabRefs.current.get(view)
      if (!host || !active) return
      const navRect = host.getBoundingClientRect()
      const rect = active.getBoundingClientRect()
      setPill({ left: rect.left - navRect.left + host.scrollLeft, width: rect.width, ready: true })
    }
    measure()
    const frame = requestAnimationFrame(measure)
    const host = navRef.current
    const observer = host ? new ResizeObserver(measure) : null
    observer?.observe(host as Element)
    if (document.fonts) void document.fonts.ready.then(() => measure())
    window.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [view])

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

        setItems([]); setError(reason instanceof Error ? reason.message : t("emails.errors.load"))

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
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("emails.errors.connectDesktop")) }
    finally { setBusy(false) }
  }

  async function action(path: string, method: string, body?: object) {

    generation.current++

    setBusy(true); setError("")

    try {

      await outlookApi(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      await load()
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("emails.errors.action")); return false }
    finally { setBusy(false) }

  }

  if (compact && onOpen) return <section aria-label={t("emails.compact.title")} className="rounded-3xl border border-border bg-background p-5 shadow-sm">
    <div className="flex items-center gap-3"><Mail className="size-5 shrink-0 text-muted-foreground" /><h2 className="text-base font-semibold">{t("emails.compact.title")}</h2>{status?.connected && <span className="ms-auto rounded-full bg-muted px-2 py-0.5 text-xs">{fmt.number(total)}</span>}</div>
    {!status ? <p className="mt-4 text-sm text-muted-foreground">{t("emails.compact.loading")}</p> : !status.connected ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("emails.compact.notConnected")}</p> : <div className="mt-3 divide-y divide-border">{items.map(item => <button key={item.id} className="block w-full py-3 text-start hover:text-primary" onClick={onOpen}><span className="block truncate text-xs text-muted-foreground" dir="auto">{item.sender}</span><span className="mt-1 line-clamp-2 text-sm font-medium" dir="auto">{item.subject}</span>{item.due_date && <span className="mt-1 block text-xs text-muted-foreground">{t("emails.list.followUpOn", { date: fmt.date(dueDay(item.due_date), { month: "short", day: "numeric" }) })}</span>}</button>)}{!items.length && <p className="py-3 text-sm text-muted-foreground">{t("emails.compact.empty")}</p>}</div>}
    {error && <p role="alert" dir="auto" className="mt-3 text-xs text-red-600">{error}</p>}
    <button className={`${button} mt-4 w-full`} onClick={onOpen}>{status?.connected ? t("emails.compact.viewAll") : t("emails.compact.connect")}</button>
  </section>

  // The app bar already names the page and the rail shows the account, so the heading is for screen readers only.
  const header = <h1 className="sr-only">{t("emails.title")}</h1>

  const errorBanner = error && <p role="alert" dir="auto" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>

  if (!status) return <section aria-label={t("emails.regionLabel")} className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-8">{header}<p className="text-sm text-muted-foreground">{t("emails.loadingConnection")}</p></section>

  // Rail placement follows the section's own width (container query), so the view also fits when embedded in onboarding.
  const layout = "grid items-start gap-5 @5xl:grid-cols-[minmax(0,1fr)_300px]"

  if (!status.connected) return <section aria-label={t("emails.regionLabel")} className="@container mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-8">
    {header}
    {errorBanner}
    <div className={layout}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-border p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5" />{t("emails.connect.desktopTitle")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("emails.connect.desktopBody")}</p>
          {status.desktop_available ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-muted/50 p-4 text-sm"><input type="checkbox" aria-label={t("emails.connect.desktopAllowLabel")} checked={busy} disabled={busy} onChange={event => { if (event.target.checked) void connectDesktop() }} /><span>{busy ? t("emails.connect.desktopConnecting") : t("emails.connect.desktopAllow")}</span></label> : <p className="mt-3 text-sm text-muted-foreground">{t("emails.connect.desktopUnavailable")}</p>}
        </div>
        <TokenConnection available={!!status.token_available} onConnected={load} />
      </div>
      <aside aria-label={t("emails.connect.privacyTitle")} className="rounded-2xl border border-border p-4 text-xs leading-5 text-muted-foreground @5xl:sticky @5xl:top-4">
        <h2 className="text-sm font-semibold text-foreground">{t("emails.connect.privacyTitle")}</h2>
        <ul className="mt-2 space-y-2">
          <li>{t("emails.connect.privacy1")}</li>
          <li>{t("emails.connect.privacy2")}</li>
          <li>{t("emails.connect.privacy3")}</li>
          <li>{t("emails.connect.privacy4")}</li>
        </ul>
      </aside>
    </div>
  </section>

  return <section aria-label={t("emails.regionLabel")} className="@container mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-8">
    {header}
    {errorBanner}
    <div className={layout}>
      <div className="min-w-0">
        <MailWorkspace key={view} items={items} total={total} busy={busy} filters={filters} onFilters={next => { setFilters(next); setOffset(0) }} offset={offset} pageSize={pageSize} onPage={setOffset} onAction={action} dismissed={view === "dismissed"} toolbar={(
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <form className="flex h-9 min-w-40 flex-1 items-center gap-1 rounded-lg border border-border bg-background ps-2" role="search" aria-label={t("emails.toolbar.searchRegion")} onSubmit={event => { event.preventDefault(); setFilters(next => ({ ...next, q: draft.trim() })); setOffset(0); setError("") }}>
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input aria-label={t("emails.toolbar.searchLabel")} dir={draft ? "auto" : undefined} autoComplete="off" maxLength={200} placeholder={t("emails.toolbar.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setDraft(filters.q) }} />
            {draft && <button type="button" aria-label={t("emails.toolbar.clearSearch")} className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground" onClick={() => { setDraft(""); setFilters(next => ({ ...next, q: "" })); setOffset(0) }}><X className="size-4" /></button>}
            <button className="me-1 shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">{t("emails.toolbar.search")}</button>
          </form>
          <select aria-label={t("emails.toolbar.filterCategory")} value={filters.category} onChange={event => { setFilters(next => ({ ...next, category: event.target.value })); setOffset(0) }} className={`${selectCls} ms-4`}><option value="">{t("emails.toolbar.allCategories")}</option>{mailCategories.map(value => <option key={value} value={value}>{t(categoryKey(value))}</option>)}</select>
          <select aria-label={t("emails.toolbar.sort")} value={filters.sort} onChange={event => { setFilters(next => ({ ...next, sort: event.target.value })); setOffset(0) }} className={selectCls}><option value="newest">{t("emails.toolbar.newest")}</option><option value="oldest">{t("emails.toolbar.oldest")}</option><option value="due">{t("emails.toolbar.due")}</option></select>
        </div>
        )} tabs={(
        <nav ref={navRef} aria-label={t("emails.views.ariaLabel")} className="relative flex h-9 w-fit min-w-0 max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5 [scrollbar-width:none]">
          <span aria-hidden="true" style={{ left: pill.left, width: pill.width, opacity: pill.ready ? 1 : 0 }} className="absolute inset-y-0.5 rounded-md bg-background shadow-sm transition-[left,width,opacity] duration-200 ease-out motion-reduce:transition-none" />
          {views.map(tab => <button key={tab} ref={node => { if (node) tabRefs.current.set(tab, node); else tabRefs.current.delete(tab) }} className={`relative z-10 h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} aria-pressed={view === tab} onClick={() => { setView(tab); setOffset(0); setError("") }}>{t(`emails.views.${tab}`)}</button>)}
        </nav>
        )} />
      </div>
      <MailboxRail status={status} busy={busy} onAction={action} onReconnected={load} />
    </div>
  </section>
}
