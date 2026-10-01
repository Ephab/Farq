"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bookmark, BriefcaseBusiness, Building2, ExternalLink, FlaskConical, MapPin, Search, Sparkles, X } from "lucide-react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { cn } from "@/lib/utils"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

type TargetState = "neutral" | "saved" | "dismissed"
type FitTier = "strong" | "good" | "explore"
type ReasonCode = { code: "skill" | "interest" | "orientation" | "location" | "program" | "role"; values: Record<string, string>; text: string }
type Tab = "matches" | "openings" | "saved" | "hidden"

interface CoopCompany {
  id: string
  name: string
  overview: string
  sectors: string[]
  skills: string[]
  tracks: string[]
  locations: string[]
  orientation: "research" | "industry"
  careers_url: string
  source_url: string
  source_status: "verified_open" | "program_page" | "closed" | "unknown"
  fetched_at: string
  fit_score: number
  fit_tier: string
  fit_tier_code?: FitTier
  reasons: string[]
  reason_codes?: ReasonCode[]
  gaps: string[]
  verified_openings: number
  state: TargetState
}

interface CoopPosting {
  id: string
  company_id: string
  company_name: string
  title: string
  description: string
  location: string
  skills: string[]
  requirements: string[]
  closes_at: string | null
  detail_url: string
  apply_url: string
  status: "verified_open" | "program_page" | "listed" | "closed" | "unknown"
  source: string
  source_status: string
  sources: { name: string; label: string; detail_url: string; apply_url: string; status: string; published_at: string | null; last_seen_at: string }[]
  published_at: string | null
  last_seen_at: string
  freshness: "today" | "recent" | "older"
  deadline_confidence: "explicit" | "unknown"
  is_demo: boolean
  fetched_at: string
  fit_score: number
  fit_tier: string
  fit_tier_code?: FitTier
  reasons: string[]
  reason_codes?: ReasonCode[]
  gaps: string[]
  state: TargetState
}

interface CoopOverview {
  companies: CoopCompany[]
  postings: CoopPosting[]
  saved_count: number
  verified_openings: number
  generated_at: string
}

type Selected = { type: "company"; item: CoopCompany } | { type: "posting"; item: CoopPosting }

function sourceLabel(status: string, demo = false): MessageKey {
  if (demo) return "dashboard.coop.source.demo"
  if (status === "verified_open") return "dashboard.coop.source.verifiedOpen"
  if (status === "closed") return "dashboard.coop.source.closed"
  if (status === "program_page") return "dashboard.coop.source.programPage"
  if (status === "listed") return "dashboard.coop.source.listed"
  return "dashboard.coop.source.unknown"
}

function sourceTone(status: string, demo = false): string {
  if (demo) return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (status === "verified_open") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  return "bg-muted text-muted-foreground"
}

function FitPill({ item }: { item: { fit_tier: string; fit_tier_code?: FitTier } }) {
  const { t } = useI18n()
  return <bdi className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">{item.fit_tier_code ? t(`dashboard.coop.tier.${item.fit_tier_code}`) : item.fit_tier}</bdi>
}

/** Match reasons in the UI language (the server also sends English text for Hermes). */
function useReasons() {
  const { t } = useI18n()
  return (item: { reasons: string[]; reason_codes?: ReasonCode[] }): string[] =>
    item.reason_codes?.length
      ? item.reason_codes.map((reason) => t(`dashboard.coop.reasons.${reason.code}`, {
          ...reason.values,
          ...(reason.values.orientation ? { orientation: t(`dashboard.coop.orientation.${reason.values.orientation as "research" | "industry"}`) } : {}),
        }))
      : item.reasons
}

function postingLink(posting: CoopPosting): { url: string; official: boolean } {
  const official = posting.source.startsWith("official") || posting.status === "verified_open"
  return { url: posting.detail_url, official }
}

export function CoopView({ onAskHermes }: { onAskHermes: (prompt: string) => void }) {
  const studentId = getCurrentStudentId()
  const { t, fmt } = useI18n()
  const [data, setData] = useState<CoopOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [tab, setTab] = useState<Tab>("matches")
  const [selected, setSelected] = useState<Selected | null>(null)
  // Openings, Saved, Hidden and search are answered by the server over every record,
  // not filtered from the eight recommendations the overview carries.
  const [list, setList] = useState<{ companies: CoopCompany[]; postings: CoopPosting[] } | null>(null)
  const listRequest = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api<CoopOverview>(`/api/students/${studentId}/coop/overview`))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("dashboard.coop.loadError"))
    } finally {
      setLoading(false)
    }
  }, [studentId, t])

  const loadList = useCallback(async () => {
    const request = ++listRequest.current
    if (tab === "matches" && !debounced) {
      setList(null)
      return
    }
    const status = tab === "saved" ? "saved" : tab === "hidden" ? "dismissed" : "all"
    const params = `status=${status}&limit=50&query=${encodeURIComponent(debounced)}`
    try {
      const [companies, postings] = await Promise.all([
        tab === "openings" ? Promise.resolve({ results: [] as CoopCompany[] }) : api<{ results: CoopCompany[] }>(`/api/students/${studentId}/coop/companies?${params}`),
        tab === "matches" ? Promise.resolve({ results: [] as CoopPosting[] }) : api<{ results: CoopPosting[] }>(`/api/students/${studentId}/coop/postings?${params}`),
      ])
      if (request === listRequest.current) setList({ companies: companies.results, postings: postings.results })
    } catch (reason) {
      if (request === listRequest.current) setError(reason instanceof Error ? reason.message : t("dashboard.coop.loadError"))
    }
  }, [studentId, tab, debounced, t])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadList() }, [loadList])

  const companies = list ? list.companies : tab === "matches" ? data?.companies ?? [] : []
  const postings = list ? list.postings : []

  const setState = async (type: "company" | "posting", id: string, status: TargetState) => {
    try {
      await api(`/api/students/${studentId}/coop/${type === "company" ? "companies" : "postings"}/${encodeURIComponent(id)}/status`, {
        method: "POST", body: JSON.stringify({ status }),
      })
      setSelected(null)
      await Promise.all([load(), loadList()])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("dashboard.coop.saveError"))
    }
  }

  const ask = (target: Selected, prepare = false) => {
    const item = target.item
    const label = "name" in item ? item.name : t("dashboard.coop.prompts.postingLabel", { title: item.title, company: item.company_name })
    onAskHermes(t(prepare ? "dashboard.coop.prompts.prepare" : "dashboard.coop.prompts.explain", { label, type: target.type, id: item.id }))
  }
  const reasonsOf = useReasons()

  if (loading) return <div aria-label={t("dashboard.coop.loadingLabel")} className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-8"><div className="h-32 animate-pulse rounded-3xl bg-muted" /><div className="h-80 animate-pulse rounded-3xl bg-muted" /></div>

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-7 grid gap-4 border-b border-border pb-7 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("dashboard.coop.eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{t("dashboard.coop.title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{t("dashboard.coop.intro")}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl border border-border p-3"><strong className="block text-2xl">{fmt.number(data?.companies.length ?? 0)}</strong><span className="text-xs text-muted-foreground">{t("dashboard.coop.companyMatches", { count: data?.companies.length ?? 0 })}</span></div>
          <div className="rounded-2xl border border-border p-3"><strong className="block text-2xl">{fmt.number(data?.verified_openings ?? 0)}</strong><span className="text-xs text-muted-foreground">{t("dashboard.coop.verifiedOpenStat")}</span></div>
        </div>
      </header>

      {error ? <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{error}</div> : null}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label={t("dashboard.coop.title")}>
          {([['matches', t("dashboard.coop.tabs.matches")], ['openings', t("dashboard.coop.tabs.openings")], ['saved', data?.saved_count ? t("dashboard.coop.tabs.savedCount", { count: data.saved_count }) : t("dashboard.coop.tabs.saved")], ['hidden', t("dashboard.coop.tabs.hidden")]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
        <label className="relative block sm:w-72">
          <Search className="absolute start-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <input type="search" aria-label={t("dashboard.coop.search")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("dashboard.coop.search")} dir={query ? "auto" : undefined} className="h-9 w-full rounded-xl border border-border bg-background ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((company) => (
          <article key={company.id} className="group flex min-h-64 flex-col rounded-3xl border border-border bg-background p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted"><Building2 className="size-5" aria-hidden="true" /></span><div><h2 className="text-lg font-semibold"><bdi>{company.name}</bdi></h2><p className="text-xs text-muted-foreground">{company.locations.map((location, index) => <span key={location}>{index > 0 ? " · " : ""}<bdi>{location}</bdi></span>)} · {t(`dashboard.coop.orientation.${company.orientation}`)}</p></div></div>
              <FitPill item={company} />
            </div>
            <p dir="auto" className="mt-4 line-clamp-2 text-start text-sm leading-6 text-muted-foreground">{company.overview}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{company.sectors.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-[11px]"><bdi>{tag}</bdi></span>)}</div>
            <div className="mt-4 border-t border-border pt-4 text-sm"><p className="font-medium">{t("dashboard.coop.whyFits")}</p><p dir="auto" className="mt-1 text-start text-muted-foreground">{reasonsOf(company)[0]}</p>{company.gaps[0] ? <p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{t("dashboard.coop.prepare")}</span> <bdi>{company.gaps[0]}</bdi></p> : null}</div>
            <div className="mt-auto flex items-center justify-between pt-5"><span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", sourceTone(company.source_status))}>{company.verified_openings ? t("dashboard.coop.verifiedOpenings", { count: company.verified_openings }) : t(sourceLabel(company.source_status))}</span><button type="button" onClick={() => setSelected({ type: "company", item: company })} className="text-sm font-semibold underline-offset-4 hover:underline">{t("dashboard.coop.viewMatch")}</button></div>
          </article>
        ))}

        {postings.map((posting) => (
          <article key={posting.id} className="flex min-h-64 flex-col rounded-3xl border border-border bg-background p-5">
            <div className="flex items-start justify-between gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted"><BriefcaseBusiness className="size-5" aria-hidden="true" /></span><FitPill item={posting} /></div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><bdi>{posting.company_name}</bdi></p><h2 dir="auto" className="mt-1 text-start text-xl font-semibold">{posting.title}</h2>
            <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" aria-hidden="true" />{posting.location ? <bdi>{posting.location}</bdi> : t("dashboard.coop.locationUnknown")}</p>
            {posting.closes_at ? <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t("dashboard.coop.detail.deadline", { date: fmt.date(posting.closes_at, { dateStyle: "medium", timeZone: "UTC" }) })}</p> : null}
            <p dir="auto" className="mt-4 text-start text-sm text-muted-foreground">{reasonsOf(posting)[0]}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5"><div className="flex flex-wrap gap-1.5">{posting.is_demo ? <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", sourceTone(posting.status, true))}>{t("dashboard.coop.source.demo")}</span> : posting.sources.map((source) => <span key={`${source.name}-${source.detail_url}`} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"><bdi>{source.label}</bdi></span>)}</div><button type="button" onClick={() => setSelected({ type: "posting", item: posting })} className="shrink-0 text-sm font-semibold underline-offset-4 hover:underline">{t("dashboard.coop.viewOpportunity")}</button></div>
          </article>
        ))}
      </div>

      {companies.length === 0 && postings.length === 0 ? <div className="grid min-h-64 place-items-center rounded-3xl border border-dashed border-border text-center"><div><BriefcaseBusiness className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 font-semibold">{t("dashboard.coop.emptyTitle")}</p><p className="mt-1 text-sm text-muted-foreground">{t("dashboard.coop.emptyBody")}</p></div></div> : null}

      {selected ? <DetailSheet selected={selected} reasons={reasonsOf(selected.item)} onClose={() => setSelected(null)} onState={setState} onAsk={ask} /> : null}
    </div>
  )
}

function DetailSheet({ selected, reasons, onClose, onState, onAsk }: { selected: Selected; reasons: string[]; onClose: () => void; onState: (type: "company" | "posting", id: string, state: TargetState) => void; onAsk: (target: Selected, prepare?: boolean) => void }) {
  const { t, fmt } = useI18n()
  const item = selected.item
  const company = selected.type === "company" ? item as CoopCompany : null
  const posting = selected.type === "posting" ? item as CoopPosting : null
  const title = company?.name ?? posting?.title ?? t("dashboard.coop.detail.fallbackTitle")
  const link = posting ? postingLink(posting) : { url: company?.source_url ?? "", official: true }
  const sheetRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Modal behavior: focus moves in, Escape closes, Tab stays inside, focus returns on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !sheetRef.current) return
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside ref={sheetRef} className="h-full w-full overflow-y-auto bg-background p-5 shadow-2xl sm:max-w-lg sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{company ? t("dashboard.coop.detail.companyMatch") : <bdi>{posting?.company_name}</bdi>}</p><h2 dir="auto" className="mt-2 text-start text-3xl font-semibold tracking-tight">{title}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t("dashboard.coop.detail.close")} className="grid size-9 place-items-center rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /></button></div>
        {posting?.closes_at ? <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300">{t("dashboard.coop.detail.deadline", { date: fmt.date(posting.closes_at, { dateStyle: "medium", timeZone: "UTC" }) })}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2"><FitPill item={item} />{posting && !posting.is_demo ? posting.sources.map((source) => <a key={`${source.name}-${source.detail_url}`} href={source.detail_url || undefined} target="_blank" rel="noreferrer" className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"><bdi>{source.label}</bdi></a>) : <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", sourceTone(company?.source_status ?? posting?.status ?? "unknown", posting?.is_demo))}>{t(sourceLabel(company?.source_status ?? posting?.status ?? "unknown", posting?.is_demo))}</span>}</div>
        <p dir="auto" className="mt-6 text-start text-sm leading-6 text-muted-foreground">{company?.overview ?? posting?.description}</p>
        <section className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">{t("dashboard.coop.detail.whyMatched")}</h3><ul className="mt-3 grid gap-2">{reasons.map((reason, index) => <li key={index} className="flex gap-2 text-sm"><Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><bdi>{reason}</bdi></li>)}</ul></section>
        <section className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">{t("dashboard.coop.detail.gaps")}</h3>{item.gaps.length ? <ul className="mt-3 grid gap-2">{item.gaps.map((gap, index) => <li key={index} className="flex gap-2 text-sm text-muted-foreground"><FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><bdi>{gap}</bdi></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{t("dashboard.coop.detail.noGap")}</p>}</section>
        {posting?.requirements.length ? <section className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">{t("dashboard.coop.detail.requirements")}</h3><ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-muted-foreground">{posting.requirements.map((requirement, index) => <li key={index}><bdi>{requirement}</bdi></li>)}</ul><p className="mt-3 text-xs text-muted-foreground">{t("dashboard.coop.detail.eligibility")}</p></section> : null}
        <div className="mt-8 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => onAsk(selected, true)} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{t("dashboard.coop.detail.buildPlan")}</button><button type="button" onClick={() => onAsk(selected)} className="h-11 rounded-xl border border-border px-4 text-sm font-semibold">{t("dashboard.coop.detail.askHermes")}</button><button type="button" onClick={() => void onState(selected.type, item.id, item.state === "saved" ? "neutral" : "saved")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"><Bookmark className="size-4" aria-hidden="true" />{item.state === "saved" ? t("dashboard.coop.detail.removeSaved") : t("dashboard.coop.detail.save")}</button>{link.url ? <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold">{t(link.official ? "dashboard.coop.detail.officialSource" : "dashboard.coop.detail.sourcePost")} <ExternalLink className="size-4 rtl:-scale-x-100" aria-hidden="true" /></a> : null}{posting?.apply_url && posting.apply_url !== link.url ? <a href={posting.apply_url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold">{t("dashboard.coop.detail.apply")} <ExternalLink className="size-4 rtl:-scale-x-100" aria-hidden="true" /></a> : null}</div>
        {item.state === "dismissed"
          ? <button type="button" onClick={() => void onState(selected.type, item.id, "neutral")} className="mt-5 text-xs font-medium underline-offset-4 hover:underline">{t("dashboard.coop.detail.showAgain")}</button>
          : <button type="button" onClick={() => void onState(selected.type, item.id, "dismissed")} className="mt-5 text-xs text-muted-foreground underline-offset-4 hover:underline">{t("dashboard.coop.detail.notRelevant")}</button>}
      </aside>
    </div>
  )
}
