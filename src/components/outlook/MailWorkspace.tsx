import { EmailQuestion } from "./EmailQuestion"
import { useEffect, useState, type ReactNode } from "react"
import { Archive, ArrowLeft, CalendarClock, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Inbox, Star } from "lucide-react"
import { localDay, outlookApi, type MailItem } from "@/lib/outlook-api"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

export type MailFilters = { q: string; category: string; sort: string }
type Changes = { pinned?: boolean; reviewed?: boolean; dismissed?: boolean; due_date?: string | null }
const control = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
/** API category values; display labels live in the `emails.categories` catalog. */
export const mailCategories = ["coursework", "administration", "opportunity", "other", "unclassified"] as const
export const categoryKey = (category: string) => `emails.categories.${category !== "other" && (mailCategories as readonly string[]).includes(category) ? category : "misc"}` as MessageKey
const chip = "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const iconChip = "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const categoryKeyFor = (item: MailItem): MessageKey => item.classification.review_reasons?.includes("beyond_cutoff") ? "emails.categories.notClassified"
  : categoryKey(item.classification.category || "unclassified")
/** due_date is a local calendar day (YYYY-MM-DD); parse it as local, not UTC. */
export const dueDay = (value: string) => { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d) }

export function MailWorkspace({ items, total, busy, filters, onFilters, offset, pageSize, onPage, onAction, dismissed, toolbar, tabs }: {
  items: MailItem[]; total: number; busy: boolean; filters: MailFilters; onFilters: (next: MailFilters) => void
  offset: number; pageSize: number; onPage: (offset: number) => void; dismissed: boolean
  onAction: (path: string, method: string, body?: object) => Promise<boolean>
  toolbar?: ReactNode
  tabs?: ReactNode
}) {
  const { t, fmt } = useI18n()
  const categoryLabel = (item: MailItem) => t(categoryKeyFor(item))
  const dateLabel = (value: string) => value ? fmt.date(value, { month: "short", day: "numeric" }) : t("emails.list.noDate")
  const dueLabel = (value: string) => fmt.date(dueDay(value), { month: "short", day: "numeric" })
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
        if (!cancelled) { setDetail(null); setDetailError(reason instanceof Error ? reason.message : t("emails.errors.openMessage")) }
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
    try { await navigator.clipboard.writeText(`${full.subject}\n${full.sender}\n\n${full.excerpt}`); setNotice(t("emails.reader.copied")) }
    catch { setNotice(t("emails.reader.clipboardUnavailable")) }
  }
  function download() {
    if (!full) return
    const url = URL.createObjectURL(new Blob([`${full.subject}\nFrom: ${full.sender}\nReceived: ${full.received}\n\n${full.excerpt}`], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url
    link.download = `${full.subject.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "email"}.txt`
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(t("emails.reader.downloaded"))
  }

  return <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
    {toolbar}
    <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" aria-label={t("emails.list.selectAll")} disabled={!items.length || busy} checked={items.length > 0 && selection.length === items.length} onChange={event => setSelected(event.target.checked ? items.map(item => item.id) : [])} />{selection.length ? t("emails.list.selected", { count: selection.length }) : t("emails.list.messages", { count: total })}</label>
      {selection.length > 0 ? <><button className={control} disabled={busy} onClick={() => void bulk({ reviewed: true })}><CheckCheck className="size-3.5" />{t("emails.list.markReviewed")}</button><button className={control} disabled={busy} onClick={() => void bulk({ pinned: true })}><Star className="size-3.5" />{t("emails.list.pin")}</button><button className={control} disabled={busy} onClick={() => void bulk({ dismissed: !dismissed })}><Archive className="size-3.5" />{dismissed ? t("emails.list.restore") : t("emails.list.dismiss")}</button><button className={control} onClick={() => setSelected([])}>{t("emails.list.clear")}</button></> : <span className="text-xs text-muted-foreground">{t("emails.list.selectHint")}</span>}
      <span className="ms-auto flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">{t("emails.list.inbox")}{tabs}</span>
    </div>
    {!items.length ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center"><Inbox className="size-10 text-muted-foreground/50" /><h2 className="font-semibold">{t("emails.list.emptyTitle")}</h2><p className="max-w-sm text-sm text-muted-foreground">{filters.q || filters.category ? t("emails.list.emptyFiltered") : t("emails.list.emptyDefault")}</p>{(filters.q || filters.category) && <button className={control} onClick={() => onFilters({ q: "", category: "", sort: "newest" })}>{t("emails.list.clearFilters")}</button>}</div> : <div className="grid min-h-[36rem] lg:h-[min(75vh,58rem)] lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.55fr)]">
      <div className={`${mobileReader ? "hidden lg:flex" : "flex"} min-h-0 flex-col lg:border-e lg:border-border`}>
        <div className="max-h-[38rem] flex-1 overflow-y-auto lg:max-h-none" aria-label={t("emails.list.listLabel")}>{items.map(item => <div key={item.id} className={`flex items-start gap-2 border-b border-border/70 px-3 py-4 transition-colors ${active?.id === item.id ? "bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)] rtl:shadow-[inset_-3px_0_0_var(--color-primary)]" : "hover:bg-muted/50"}`}>
          <input type="checkbox" className="mt-1.5 shrink-0" aria-label={t("emails.list.selectOne", { subject: item.subject })} disabled={busy} checked={selection.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selection, item.id] : selection.filter(id => id !== item.id))} />
          <button className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={active?.id === item.id} onClick={() => { setActiveId(item.id); setMobileReader(true); setDetailError(""); setNotice("") }}>
            <div className="flex items-center gap-2"><span className="truncate text-xs font-medium" dir="auto">{item.sender}</span><span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{dateLabel(item.received)}</span></div>
            <div className="mt-1.5 flex items-start gap-2"><h2 dir="auto" className={`line-clamp-2 text-sm leading-5 ${item.reviewed ? "font-medium" : "font-semibold"}`}>{item.subject}</h2>{item.pinned && <Star className="mt-0.5 size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label={t("emails.list.pinned")} />}</div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground" dir="auto">{item.excerpt || t("emails.list.noText")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded-md bg-muted px-2 py-0.5">{categoryLabel(item)}</span>{!item.reviewed && <span className="text-blue-600 dark:text-blue-400">{t("emails.list.needsReview")}</span>}{item.due_date && <span className={item.due_date < localDay() ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>{t("emails.list.followUpOn", { date: dueLabel(item.due_date) })}</span>}</div>
          </button>
        </div>)}</div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-3"><button className={control} aria-label={t("emails.list.previousPage")} disabled={offset === 0 || busy} onClick={() => { setSelected([]); onPage(Math.max(0, offset - pageSize)) }}><ChevronLeft className="size-4 rtl:-scale-x-100" /></button><span className="text-xs text-muted-foreground">{t("emails.list.range", { from: offset + 1, to: Math.min(offset + items.length, total), total })}</span><button className={control} aria-label={t("emails.list.nextPage")} disabled={offset + pageSize >= total || busy} onClick={() => { setSelected([]); onPage(offset + pageSize) }}><ChevronRight className="size-4 rtl:-scale-x-100" /></button></div>
      </div>
      {active && <article className={`${mobileReader ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`} aria-label={t("emails.reader.label")}>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <button className={`${control} mb-3 lg:hidden`} onClick={() => setMobileReader(false)}><ArrowLeft className="size-4 rtl:-scale-x-100" />{t("emails.reader.back")}</button>
          <h2 className="break-words text-base font-semibold leading-6 tracking-tight" dir="auto">{active.subject}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground" dir="auto">{active.sender}</span>
            <span>{active.received ? fmt.dateTime(active.received) : t("emails.reader.dateUnavailable")}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">{categoryLabel(active)}</span>
            {!active.reviewed && <span className="text-[10px] text-blue-600 dark:text-blue-400">{t("emails.list.needsReview")}</span>}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button className={chip} disabled={busy} aria-pressed={active.pinned} onClick={() => patch({ pinned: !active.pinned })}><Star className={`size-3 ${active.pinned ? "fill-amber-400 text-amber-500" : ""}`} />{active.pinned ? t("emails.list.pinned") : t("emails.list.pin")}</button>
            <button className={chip} disabled={busy} onClick={() => patch({ reviewed: !active.reviewed })}><Check className="size-3" />{active.reviewed ? t("emails.reader.reviewAgain") : t("emails.list.markReviewed")}</button>
            <button className={chip} disabled={busy} onClick={() => patch({ dismissed: !active.dismissed })}><Archive className="size-3" />{active.dismissed ? t("emails.list.restore") : t("emails.list.dismiss")}</button>
            <button className={chip} disabled={busy} aria-expanded={followUpOpen} onClick={() => setFollowUpOpen(open => !open)}><CalendarClock className="size-3" />{active.due_date ? t("emails.list.followUpOn", { date: dueLabel(active.due_date) }) : t("emails.reader.followUp")}</button>
            {active.web_url && <a className={chip} href={active.web_url} target="_blank" rel="noopener noreferrer">Outlook<ExternalLink className="size-3" /></a>}
            <span className="ms-auto flex gap-1">
              <button className={iconChip} aria-label={t("emails.reader.copy")} title={t("emails.reader.copy")} disabled={!full} onClick={() => void copy()}><Copy className="size-3.5" /></button>
              <button className={iconChip} aria-label={t("emails.reader.save")} title={t("emails.reader.save")} disabled={!full} onClick={download}><Download className="size-3.5" /></button>
            </span>
          </div>
          {followUpOpen && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" title={t("emails.reader.followUpHint")}>
            <span className="text-muted-foreground">{t("emails.reader.dueDate")}</span>
            <input aria-label={t("emails.reader.followUpDate")} type="date" value={active.due_date || ""} disabled={busy} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs" onChange={event => patch({ due_date: event.target.value || null })} />
            <button className={chip} disabled={busy} onClick={() => patch({ due_date: localDay() })}>{t("emails.reader.today")}</button>
            <button className={chip} disabled={busy} onClick={() => patch({ due_date: tomorrow() })}>{t("emails.reader.tomorrow")}</button>
            {active.due_date && <button className={chip} disabled={busy} onClick={() => patch({ due_date: null })}>{t("emails.list.clear")}</button>}
          </div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {notice && <p role="status" className="mb-3 text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>}
          {detailError ? <p role="alert" dir="auto" className="text-sm text-red-600">{detailError}</p> : !full ? <p role="status" className="animate-pulse text-sm text-muted-foreground">{t("emails.reader.loading")}</p> : <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{full.excerpt || t("emails.reader.noText")}</p>}
          <p className="mt-8 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">{active.classification.review_reasons?.includes("beyond_cutoff") ? t("emails.reader.beyondCutoff") : t("emails.reader.suggestions", { engine: active.classification.review_reasons?.includes("engine_span") ? "Span-01 Lite" : active.classification.review_reasons?.includes("engine_jev") ? "Jev" : "Laya" })}{" "}{active.classification.review_reasons?.includes("unsupported_language") ? `${t("emails.reader.unsupportedLanguage")} ` : ""}{t("emails.reader.cacheNote")}</p>
        </div>
        <EmailQuestion key={(selection.length ? selection : [active.id]).join(",")} ids={selection.length ? selection : [active.id]} />
      </article>}
    </div>}
  </div>
}
