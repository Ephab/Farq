import { EmailQuestion } from "./EmailQuestion"
import { useEffect, useState, type ReactNode } from "react"
import { Archive, ArrowLeft, CalendarClock, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Inbox, Star } from "lucide-react"
import { localDay, outlookApi, type MailItem } from "@/lib/outlook-api"

export type MailFilters = { q: string; category: string; sort: string }
type Changes = { pinned?: boolean; reviewed?: boolean; dismissed?: boolean; due_date?: string | null }
const control = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
export const mailCategories: Record<string, string> = { coursework: "Coursework", administration: "University admin", opportunity: "Opportunities", other: "Other", unclassified: "Unclassified" }
const chip = "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const iconChip = "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const categoryLabel = (item: MailItem) => item.classification.review_reasons?.includes("beyond_cutoff") ? "Not classified"
  : mailCategories[item.classification.category || "unclassified"] || "Other"
const dateLabel = (value: string) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"

export function MailWorkspace({ items, total, busy, filters, onFilters, offset, pageSize, onPage, onAction, dismissed, toolbar, tabs }: {
  items: MailItem[]; total: number; busy: boolean; filters: MailFilters; onFilters: (next: MailFilters) => void
  offset: number; pageSize: number; onPage: (offset: number) => void; dismissed: boolean
  onAction: (path: string, method: string, body?: object) => Promise<boolean>
  toolbar?: ReactNode
  tabs?: ReactNode
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobileReader, setMobileReader] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [detail, setDetail] = useState<MailItem | null>(null)
  const [detailError, setDetailError] = useState("")
  const [notice, setNotice] = useState("")
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const active = items.find(item => item.id === activeId) || items[0]
  const selection = selected.filter(id => items.some(item => item.id === id))
  const full = detail?.id === active?.id ? detail : null

  useEffect(() => {
    setFollowUpOpen(false)
  }, [active?.id])

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
    {toolbar}
    <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" aria-label="Select all emails on this page" disabled={!items.length || busy} checked={items.length > 0 && selection.length === items.length} onChange={event => setSelected(event.target.checked ? items.map(item => item.id) : [])} />{selection.length ? `${selection.length} selected` : `${total} ${total === 1 ? "message" : "messages"}`}</label>
      {selection.length > 0 ? <><button className={control} disabled={busy} onClick={() => void bulk({ reviewed: true })}><CheckCheck className="size-3.5" />Mark reviewed</button><button className={control} disabled={busy} onClick={() => void bulk({ pinned: true })}><Star className="size-3.5" />Pin</button><button className={control} disabled={busy} onClick={() => void bulk({ dismissed: !dismissed })}><Archive className="size-3.5" />{dismissed ? "Restore" : "Dismiss"}</button><button className={control} onClick={() => setSelected([])}>Clear</button></> : <span className="text-xs text-muted-foreground">Select messages to review them together</span>}
      <span className="ml-auto flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">Inbox:{tabs}</span>
    </div>
    {!items.length ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center"><Inbox className="size-10 text-muted-foreground/50" /><h2 className="font-semibold">Nothing here right now</h2><p className="max-w-sm text-sm text-muted-foreground">{filters.q || filters.category ? "Try another search or category. Search includes the complete cached message text." : "Messages will appear here as your mailbox syncs. Try All mail to see other updates."}</p>{(filters.q || filters.category) && <button className={control} onClick={() => onFilters({ q: "", category: "", sort: "newest" })}>Clear filters</button>}</div> : <div className="grid min-h-[36rem] lg:h-[min(75vh,58rem)] lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.55fr)]">
      <div className={`${mobileReader ? "hidden lg:flex" : "flex"} min-h-0 flex-col lg:border-r lg:border-border`}>
        <div className="max-h-[38rem] flex-1 overflow-y-auto lg:max-h-none" aria-label="Email list">{items.map(item => <div key={item.id} className={`flex items-start gap-2 border-b border-border/70 px-3 py-4 transition-colors ${active?.id === item.id ? "bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-muted/50"}`}>
          <input type="checkbox" className="mt-1.5 shrink-0" aria-label={`Select ${item.subject}`} disabled={busy} checked={selection.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selection, item.id] : selection.filter(id => id !== item.id))} />
          <button className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={active?.id === item.id} onClick={() => { setActiveId(item.id); setMobileReader(true); setDetailError(""); setNotice("") }}>
            <div className="flex items-center gap-2"><span className="truncate text-xs font-medium">{item.sender}</span><span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{dateLabel(item.received)}</span></div>
            <div className="mt-1.5 flex items-start gap-2"><h2 className={`line-clamp-2 text-sm leading-5 ${item.reviewed ? "font-medium" : "font-semibold"}`}>{item.subject}</h2>{item.pinned && <Star className="mt-0.5 size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Pinned" />}</div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground" dir="auto">{item.excerpt || "No message text"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded-md bg-muted px-2 py-0.5">{categoryLabel(item)}</span>{!item.reviewed && <span className="text-blue-600 dark:text-blue-400">Needs review</span>}{item.due_date && <span className={item.due_date < localDay() ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>Follow up {item.due_date}</span>}</div>
          </button>
        </div>)}</div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-3"><button className={control} aria-label="Previous email page" disabled={offset === 0 || busy} onClick={() => { setSelected([]); onPage(Math.max(0, offset - pageSize)) }}><ChevronLeft className="size-4" /></button><span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + items.length, total)} of {total}</span><button className={control} aria-label="Next email page" disabled={offset + pageSize >= total || busy} onClick={() => { setSelected([]); onPage(offset + pageSize) }}><ChevronRight className="size-4" /></button></div>
      </div>
      {active && <article className={`${mobileReader ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`} aria-label="Email reader">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <button className={`${control} mb-3 lg:hidden`} onClick={() => setMobileReader(false)}><ArrowLeft className="size-4" />Back to inbox</button>
          <h2 className="break-words text-base font-semibold leading-6 tracking-tight" dir="auto">{active.subject}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{active.sender}</span>
            <span>{active.received ? new Date(active.received).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable"}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">{categoryLabel(active)}</span>
            {!active.reviewed && <span className="text-[10px] text-blue-600 dark:text-blue-400">Needs review</span>}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button className={chip} disabled={busy} aria-pressed={active.pinned} onClick={() => patch({ pinned: !active.pinned })}><Star className={`size-3 ${active.pinned ? "fill-amber-400 text-amber-500" : ""}`} />{active.pinned ? "Pinned" : "Pin"}</button>
            <button className={chip} disabled={busy} onClick={() => patch({ reviewed: !active.reviewed })}><Check className="size-3" />{active.reviewed ? "Review again" : "Mark reviewed"}</button>
            <button className={chip} disabled={busy} onClick={() => patch({ dismissed: !active.dismissed })}><Archive className="size-3" />{active.dismissed ? "Restore" : "Dismiss"}</button>
            <button className={chip} disabled={busy} aria-expanded={followUpOpen} onClick={() => setFollowUpOpen(open => !open)}><CalendarClock className="size-3" />{active.due_date ? `Follow up ${active.due_date}` : "Follow up"}</button>
            {active.web_url && <a className={chip} href={active.web_url} target="_blank" rel="noopener noreferrer">Outlook<ExternalLink className="size-3" /></a>}
            <span className="ml-auto flex gap-1">
              <button className={iconChip} aria-label="Copy email text" title="Copy email text" disabled={!full} onClick={() => void copy()}><Copy className="size-3.5" /></button>
              <button className={iconChip} aria-label="Save email as text" title="Save email as text" disabled={!full} onClick={download}><Download className="size-3.5" /></button>
            </span>
          </div>
          {followUpOpen && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" title="Shows in Follow-ups, and in Today when due. No notification is sent.">
            <span className="text-muted-foreground">Due date</span>
            <input aria-label="Follow-up date" type="date" value={active.due_date || ""} disabled={busy} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs" onChange={event => patch({ due_date: event.target.value || null })} />
            <button className={chip} disabled={busy} onClick={() => patch({ due_date: localDay() })}>Today</button>
            <button className={chip} disabled={busy} onClick={() => patch({ due_date: tomorrow() })}>Tomorrow</button>
            {active.due_date && <button className={chip} disabled={busy} onClick={() => patch({ due_date: null })}>Clear</button>}
          </div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {notice && <p role="status" className="mb-3 text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>}
          {detailError ? <p role="alert" className="text-sm text-red-600">{detailError}</p> : !full ? <p role="status" className="animate-pulse text-sm text-muted-foreground">Loading full message…</p> : <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{full.excerpt || "This email has no readable text. Attachments are not imported."}</p>}
          <p className="mt-8 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">{active.classification.review_reasons?.includes("beyond_cutoff") ? "Not classified: older than your classifier cutoff. " : `${active.classification.review_reasons?.includes("engine_span") ? "Span-01 Lite" : active.classification.review_reasons?.includes("engine_jev") ? "Jev" : "Laya"} categories are suggestions, not confirmed facts. `}{active.classification.review_reasons?.includes("unsupported_language") ? "This language needs manual review. " : ""}Actions here affect your Waypoint cache only. Cleaned text is retained for 30 days.</p>
        </div>
        <EmailQuestion key={(selection.length ? selection : [active.id]).join(",")} ids={selection.length ? selection : [active.id]} />
      </article>}
    </div>}
  </div>
}
