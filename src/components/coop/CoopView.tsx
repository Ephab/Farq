"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bookmark, BriefcaseBusiness, Building2, ExternalLink, FlaskConical, MapPin, Search, Sparkles, X } from "lucide-react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { cn } from "@/lib/utils"

type TargetState = "neutral" | "saved" | "dismissed"

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
  reasons: string[]
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
  reasons: string[]
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

function sourceLabel(status: string, demo = false): string {
  if (demo) return "Demo fallback"
  if (status === "verified_open") return "Verified open"
  if (status === "closed") return "Currently closed"
  if (status === "program_page") return "Official program page"
  if (status === "listed") return "Recently listed"
  return "Availability unknown"
}

function sourceTone(status: string, demo = false): string {
  if (demo) return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (status === "verified_open") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  return "bg-muted text-muted-foreground"
}

function FitPill({ tier }: { tier: string }) {
  return <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">{tier}</span>
}

export function CoopView({ onAskHermes }: { onAskHermes: (prompt: string) => void }) {
  const studentId = getCurrentStudentId()
  const [data, setData] = useState<CoopOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<"matches" | "openings" | "saved">("matches")
  const [selected, setSelected] = useState<Selected | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api<CoopOverview>(`/api/students/${studentId}/coop/overview`))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load co-op matches")
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => { void load() }, [load])

  const companies = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    return data.companies.filter((item) => {
      if (tab === "saved" && item.state !== "saved") return false
      if (tab === "openings") return false
      return !needle || [item.name, item.overview, ...item.sectors, ...item.tracks].join(" ").toLowerCase().includes(needle)
    })
  }, [data, query, tab])

  const postings = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    return data.postings.filter((item) => {
      if (tab === "matches") return false
      if (tab === "saved" && item.state !== "saved") return false
      return !needle || [item.title, item.company_name, item.location, ...item.skills].join(" ").toLowerCase().includes(needle)
    })
  }, [data, query, tab])

  const setState = async (type: "company" | "posting", id: string, status: TargetState) => {
    try {
      await api(`/api/students/${studentId}/coop/${type === "company" ? "companies" : "postings"}/${id}/status`, {
        method: "POST", body: JSON.stringify({ status }),
      })
      await load()
      setSelected(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that choice")
    }
  }

  const ask = (target: Selected, prepare = false) => {
    const item = target.item
    const label = "name" in item ? item.name : `${item.title} at ${item.company_name}`
    const prompt = prepare
      ? `Build a practical co-op preparation plan for ${label}. Target type: ${target.type}; target id: ${item.id}. Read the authoritative co-op target and my active roadmap first, then propose only the future roadmap changes that close important gaps.`
      : `Explain why ${label} matches me, what I still need to improve, and what I should verify before applying. Target type: ${target.type}; target id: ${item.id}. Use the authoritative Waypoint co-op target.`
    onAskHermes(prompt)
  }

  if (loading) return <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-8"><div className="h-32 animate-pulse rounded-3xl bg-muted" /><div className="h-80 animate-pulse rounded-3xl bg-muted" /></div>

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-7 grid gap-4 border-b border-border pb-7 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your path into work</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Find a co-op worth preparing for.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Waypoint matches your demonstrated skills and direction to Saudi organizations, then shows the gaps you can close before applying.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl border border-border p-3"><strong className="block text-2xl">{data?.companies.length ?? 0}</strong><span className="text-xs text-muted-foreground">company matches</span></div>
          <div className="rounded-2xl border border-border p-3"><strong className="block text-2xl">{data?.verified_openings ?? 0}</strong><span className="text-xs text-muted-foreground">verified open</span></div>
        </div>
      </header>

      {error ? <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{error}</div> : null}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist">
          {([['matches', 'For you'], ['openings', 'Openings'], ['saved', `Saved${data?.saved_count ? ` ${data.saved_count}` : ''}`]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn("rounded-lg px-3 py-2 text-sm font-medium", tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
        <label className="relative block sm:w-72">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, field, location…" className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((company) => (
          <article key={company.id} className="group flex min-h-64 flex-col rounded-3xl border border-border bg-background p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted"><Building2 className="size-5" /></span><div><h2 className="text-lg font-semibold">{company.name}</h2><p className="text-xs text-muted-foreground">{company.locations.join(" · ")} · {company.orientation}</p></div></div>
              <FitPill tier={company.fit_tier} />
            </div>
            <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">{company.overview}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{company.sectors.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-[11px]">{tag}</span>)}</div>
            <div className="mt-4 border-t border-border pt-4 text-sm"><p className="font-medium">Why it fits</p><p className="mt-1 text-muted-foreground">{company.reasons[0]}</p>{company.gaps[0] ? <p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Prepare:</span> {company.gaps[0]}</p> : null}</div>
            <div className="mt-auto flex items-center justify-between pt-5"><span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", sourceTone(company.source_status))}>{company.verified_openings ? `${company.verified_openings} verified opening` : sourceLabel(company.source_status)}</span><button type="button" onClick={() => setSelected({ type: "company", item: company })} className="text-sm font-semibold underline-offset-4 hover:underline">View match</button></div>
          </article>
        ))}

        {postings.map((posting) => (
          <article key={posting.id} className="flex min-h-64 flex-col rounded-3xl border border-border bg-background p-5">
            <div className="flex items-start justify-between gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted"><BriefcaseBusiness className="size-5" /></span><FitPill tier={posting.fit_tier} /></div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{posting.company_name}</p><h2 className="mt-1 text-xl font-semibold">{posting.title}</h2>
            <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" />{posting.location || "Location not stated"}</p>
            <p className="mt-4 text-sm text-muted-foreground">{posting.reasons[0]}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5"><div className="flex flex-wrap gap-1.5">{posting.is_demo ? <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", sourceTone(posting.status, true))}>Demo fallback</span> : posting.sources.map((source) => <span key={`${source.name}-${source.detail_url}`} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{source.label}</span>)}</div><button type="button" onClick={() => setSelected({ type: "posting", item: posting })} className="shrink-0 text-sm font-semibold underline-offset-4 hover:underline">View opportunity</button></div>
          </article>
        ))}
      </div>

      {companies.length === 0 && postings.length === 0 ? <div className="grid min-h-64 place-items-center rounded-3xl border border-dashed border-border text-center"><div><BriefcaseBusiness className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 font-semibold">No matches in this view</p><p className="mt-1 text-sm text-muted-foreground">Try another search or save a recommendation first.</p></div></div> : null}

      {selected ? <DetailSheet selected={selected} onClose={() => setSelected(null)} onState={setState} onAsk={ask} /> : null}
    </div>
  )
}

function DetailSheet({ selected, onClose, onState, onAsk }: { selected: Selected; onClose: () => void; onState: (type: "company" | "posting", id: string, state: TargetState) => void; onAsk: (target: Selected, prepare?: boolean) => void }) {
  const item = selected.item
  const company = selected.type === "company" ? item as CoopCompany : null
  const posting = selected.type === "posting" ? item as CoopPosting : null
  const title = company?.name ?? posting?.title ?? "Co-op match"
  const officialUrl = company?.source_url ?? posting?.detail_url ?? ""
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside className="h-full w-full overflow-y-auto bg-background p-5 shadow-2xl sm:max-w-lg sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{company ? "Company match" : posting?.company_name}</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2></div><button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full border border-border"><X className="size-4" /></button></div>
        <div className="mt-5 flex flex-wrap gap-2"><FitPill tier={item.fit_tier} />{posting && !posting.is_demo ? posting.sources.map((source) => <a key={`${source.name}-${source.detail_url}`} href={source.detail_url || undefined} target="_blank" rel="noreferrer" className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{source.label}</a>) : <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", sourceTone(company?.source_status ?? posting?.status ?? "unknown", posting?.is_demo))}>{sourceLabel(company?.source_status ?? posting?.status ?? "unknown", posting?.is_demo)}</span>}</div>
        <p className="mt-6 text-sm leading-6 text-muted-foreground">{company?.overview ?? posting?.description}</p>
        <section className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">Why Waypoint matched you</h3><ul className="mt-3 grid gap-2">{item.reasons.map((reason) => <li key={reason} className="flex gap-2 text-sm"><Sparkles className="mt-0.5 size-4 shrink-0" />{reason}</li>)}</ul></section>
        <section className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">Preparation gaps</h3>{item.gaps.length ? <ul className="mt-3 grid gap-2">{item.gaps.map((gap) => <li key={gap} className="flex gap-2 text-sm text-muted-foreground"><FlaskConical className="mt-0.5 size-4 shrink-0" />{gap}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No major gap is visible from your confirmed Waypoint records.</p>}</section>
        {posting?.requirements.length ? <section className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">Source requirements</h3><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{posting.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul><p className="mt-3 text-xs text-muted-foreground">Unknown eligibility is not treated as eligible. Verify every requirement on the official page.</p></section> : null}
        <div className="mt-8 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => onAsk(selected, true)} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Build preparation plan</button><button type="button" onClick={() => onAsk(selected)} className="h-11 rounded-xl border border-border px-4 text-sm font-semibold">Ask Hermes</button><button type="button" onClick={() => void onState(selected.type, item.id, item.state === "saved" ? "neutral" : "saved")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"><Bookmark className="size-4" />{item.state === "saved" ? "Remove saved" : "Save"}</button>{officialUrl ? <a href={officialUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold">Official source <ExternalLink className="size-4" /></a> : null}</div>
        <button type="button" onClick={() => void onState(selected.type, item.id, "dismissed")} className="mt-5 text-xs text-muted-foreground underline-offset-4 hover:underline">Not relevant to me</button>
      </aside>
    </div>
  )
}
