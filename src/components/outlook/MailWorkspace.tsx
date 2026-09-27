import { EmailQuestion } from "./EmailQuestion"
import { useEffect, useState } from "react"
import { Archive, ArrowLeft, CalendarClock, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Inbox, Search, Star, X } from "lucide-react"
import { localDay, outlookApi, type MailItem } from "@/lib/outlook-api"

export type MailFilters = { q: string; category: string; sort: string }
type Changes = { pinned?: boolean; reviewed?: boolean; dismissed?: boolean; due_date?: string | null }
const control = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const categories: Record<string, string> = { coursework: "Coursework", administration: "University admin", opportunity: "Opportunities", other: "Other", unclassified: "Unclassified" }
const dateLabel = (value: string) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"

export function MailWorkspace({ items, total, busy, filters, onFilters, offset, pageSize, onPage, onAction, dismissed }: {
  items: MailItem[]; total: number; busy: boolean; filters: MailFilters; onFilters: (next: MailFilters) => void
  offset: number; pageSize: number; onPage: (offset: number) => void; dismissed: boolean
  onAction: (path: string, method: string, body?: object) => Promise<boolean>
}) {
  const [search, setSearch] = useState(filters.q)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobileReader, setMobileReader] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [detail, setDetail] = useState<MailItem | null>(null)
  const [detailError, setDetailError] = useState("")
  const [notice, setNotice] = useState("")
  const active = items.find(item => item.id === activeId) || items[0]
  const selection = selected.filter(id => items.some(item => item.id === id))
  const full = detail?.id === active?.id ? detail : null

  useEffect(() => {
    let cancelled = false
    if (active) {
      void outlookApi<MailItem>(`/messages/${active.id}`).then(message => {
        if (!cancelled) { setDetail(message); setDetailError(""); setNotice("") }
      }).catch(reason => {
        if (!cancelled) { setDetail(null); setDetailError(reason instanceof Error ? reason.message : "Could not open this message") }
      })
    }
    return () => { cancelled = true }
  }, [active])

  function patch(changes: Changes) {
    if (active) void onAction(`/messages/${active.id}`, "PATCH", changes)
  }
  async function bulk(changes: Changes) {
    if (await onAction("/messages/bulk", "POST", { ids: selection, changes })) setSelected([])
  }
  function tomorrow() {
    const day = new Date(); day.setDate(day.getDate() + 1)
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
  }
  async function copy() {
    if (!full) return
    try { await navigator.clipboard.writeText(`${full.subject}\n${full.sender}\n\n${full.excerpt}`); setNotice("Email text copied") }
    catch { setNotice("Clipboard unavailable. Select and copy the text below.") }
  }
  function download() {
    if (!full) return
    const url = URL.createObjectURL(new Blob([`${full.subject}\nFrom: ${full.sender}\nReceived: ${full.received}\n\n${full.excerpt}`], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url
    link.download = `${full.subject.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "email"}.txt`
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice("Cleaned email downloaded")
  }

  return <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 p-3">
      <form className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-border bg-background pl-3" onSubmit={event => { event.preventDefault(); setSelected([]); onFilters({ ...filters, q: search.trim() }) }} role="search" aria-label="Search university mail">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input aria-label="Search emails" maxLength={200} placeholder="Search sender, subject or message…" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" value={search} onChange={event => setSearch(event.target.value)} />
        {search && <button type="button" aria-label="Clear search" className="p-2" onClick={() => { setSearch(""); onFilters({ ...filters, q: "" }) }}><X className="size-4" /></button>}
        <button className="mr-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Search</button>
      </form>
      <select aria-label="Filter by category" value={filters.category} onChange={event => { setSelected([]); onFilters({ ...filters, category: event.target.value }) }} className={control}><option value="">All categories</option>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Sort emails" value={filters.sort} onChange={event => onFilters({ ...filters, sort: event.target.value })} className={control}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="due">Follow-up date</option></select>
    </div>
    <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <label className="mr-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" aria-label="Select all emails on this page" disabled={!items.length || busy} checked={items.length > 0 && selection.length === items.length} onChange={event => setSelected(event.target.checked ? items.map(item => item.id) : [])} />{selection.length ? `${selection.length} selected` : `${total} ${total === 1 ? "message" : "messages"}`}</label>
      {selection.length > 0 ? <><button className={control} disabled={busy} onClick={() => void bulk({ reviewed: true })}><CheckCheck className="size-3.5" />Mark reviewed</button><button className={control} disabled={busy} onClick={() => void bulk({ pinned: true })}><Star className="size-3.5" />Pin</button><button className={control} disabled={busy} onClick={() => void bulk({ dismissed: !dismissed })}><Archive className="size-3.5" />{dismissed ? "Restore" : "Dismiss"}</button><button className={control} onClick={() => setSelected([])}>Clear</button></> : <span className="text-xs text-muted-foreground">Select messages to review them together</span>}
      <span className="ml-auto rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Local & private</span>
    </div>
    {active && <EmailQuestion key={(selection.length ? selection : [active.id]).join(",")} ids={selection.length ? selection : [active.id]} />}
    {!items.length ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center"><Inbox className="size-10 text-muted-foreground/50" /><h2 className="font-semibold">Nothing here right now</h2><p className="max-w-sm text-sm text-muted-foreground">{filters.q || filters.category ? "Try another search or category. Search includes the complete cached message text." : "Messages will appear here as your mailbox syncs. Try All mail to see other updates."}</p>{(filters.q || filters.category) && <button className={control} onClick={() => { setSearch(""); onFilters({ q: "", category: "", sort: "newest" }) }}>Clear filters</button>}</div> : <div className="grid min-h-[36rem] lg:h-[min(75vh,58rem)] lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.55fr)]">
      <div className={`${mobileReader ? "hidden lg:flex" : "flex"} min-h-0 flex-col lg:border-r lg:border-border`}>
        <div className="max-h-[38rem] flex-1 overflow-y-auto lg:max-h-none" aria-label="Email list">{items.map(item => <div key={item.id} className={`flex items-start gap-2 border-b border-border/70 px-3 py-4 transition-colors ${active?.id === item.id ? "bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-muted/50"}`}>
          <input type="checkbox" className="mt-1.5 shrink-0" aria-label={`Select ${item.subject}`} disabled={busy} checked={selection.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selection, item.id] : selection.filter(id => id !== item.id))} />
          <button className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={active?.id === item.id} onClick={() => { setActiveId(item.id); setMobileReader(true); setDetailError(""); setNotice("") }}>
            <div className="flex items-center gap-2"><span className="truncate text-xs font-medium">{item.sender}</span><span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{dateLabel(item.received)}</span></div>
            <div className="mt-1.5 flex items-start gap-2"><h2 className={`line-clamp-2 text-sm leading-5 ${item.reviewed ? "font-medium" : "font-semibold"}`}>{item.subject}</h2>{item.pinned && <Star className="mt-0.5 size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Pinned" />}</div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground" dir="auto">{item.excerpt || "No message text"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded-md bg-muted px-2 py-0.5">{categories[item.classification.category || "unclassified"] || "Other"}</span>{!item.reviewed && <span className="text-blue-600 dark:text-blue-400">Needs review</span>}{item.due_date && <span className={item.due_date < localDay() ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>Follow up {item.due_date}</span>}</div>
          </button>
        </div>)}</div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-3"><button className={control} aria-label="Previous email page" disabled={offset === 0 || busy} onClick={() => { setSelected([]); onPage(Math.max(0, offset - pageSize)) }}><ChevronLeft className="size-4" /></button><span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + items.length, total)} of {total}</span><button className={control} aria-label="Next email page" disabled={offset + pageSize >= total || busy} onClick={() => { setSelected([]); onPage(offset + pageSize) }}><ChevronRight className="size-4" /></button></div>
      </div>
      {active && <article className={`${mobileReader ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`} aria-label="Email reader">
        <div className="border-b border-border p-4 sm:p-6">
          <button className={`${control} mb-4 lg:hidden`} onClick={() => setMobileReader(false)}><ArrowLeft className="size-4" />Back to inbox</button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="rounded-md bg-muted px-2 py-1">{categories[active.classification.category || "unclassified"] || "Other"}</span><span>{active.reviewed ? "Reviewed" : "Needs your review"}</span></div>
          <h2 className="mt-3 break-words text-xl font-semibold leading-7 tracking-tight" dir="auto">{active.subject}</h2>
          <p className="mt-2 text-sm font-medium">{active.sender}</p><p className="mt-1 text-xs text-muted-foreground">{active.received ? new Date(active.received).toLocaleString() : "Received date unavailable"}</p>
          <div className="mt-4 flex flex-wrap gap-2"><button className={control} disabled={busy} aria-pressed={active.pinned} onClick={() => patch({ pinned: !active.pinned })}><Star className={`size-3.5 ${active.pinned ? "fill-amber-400 text-amber-500" : ""}`} />{active.pinned ? "Pinned" : "Pin"}</button><button className={control} disabled={busy} onClick={() => patch({ reviewed: !active.reviewed })}><Check className="size-3.5" />{active.reviewed ? "Review again" : "Mark reviewed"}</button><button className={control} disabled={busy} onClick={() => patch({ dismissed: !active.dismissed })}><Archive className="size-3.5" />{active.dismissed ? "Restore" : "Dismiss"}</button>{active.web_url && <a className={control} href={active.web_url} target="_blank" rel="noopener noreferrer">Outlook<ExternalLink className="size-3.5" /></a>}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-5 rounded-xl border border-border bg-muted/25 p-3"><div className="flex items-center gap-2 text-xs font-semibold"><CalendarClock className="size-4" />Your follow-up date</div><div className="mt-2 flex flex-wrap items-center gap-2"><input aria-label="Follow-up date" type="date" value={active.due_date || ""} disabled={busy} className={control} onChange={event => patch({ due_date: event.target.value || null })} /><button className={control} disabled={busy} onClick={() => patch({ due_date: localDay() })}>Today</button><button className={control} disabled={busy} onClick={() => patch({ due_date: tomorrow() })}>Tomorrow</button>{active.due_date && <button className={control} disabled={busy} onClick={() => patch({ due_date: null })}>Clear date</button>}</div><p className="mt-2 text-[11px] text-muted-foreground">Appears in Follow-ups and in Today when due. No notification is scheduled.</p></div>
          <div className="mb-4 flex flex-wrap items-center gap-2"><span className="mr-auto text-xs font-medium text-muted-foreground">Complete cleaned message</span><button className={control} disabled={!full} onClick={() => void copy()}><Copy className="size-3.5" />Copy</button><button className={control} disabled={!full} onClick={download}><Download className="size-3.5" />Save text</button></div>
          {notice && <p role="status" className="mb-3 text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>}
          {detailError ? <p role="alert" className="text-sm text-red-600">{detailError}</p> : !full ? <p role="status" className="animate-pulse text-sm text-muted-foreground">Loading full message…</p> : <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{full.excerpt || "This email has no readable text. Attachments are not imported."}</p>}
          <p className="mt-8 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">Laya categories are suggestions, not confirmed facts. {active.classification.review_reasons?.includes("unsupported_language") ? "This language needs manual review. " : ""}Actions here affect your Farq cache only. Cleaned text is retained for 30 days.</p>
        </div>
      </article>}
    </div>}
  </div>
}
