"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Info, LoaderCircle } from "lucide-react"
import { api, sourceKindLabel, type DataSourceItem, type EvidenceItem, type StudentProfile } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

const GROUPS = ["education", "course", "project", "experience", "skill", "certificate", "publication", "activity"] as const

/** Unicode first-strong isolate: keeps a file name or title from reordering the sentence around it. */
const isolate = (text: string) => `⁨${text}⁩`

/** Records imported before README text was cleaned can still carry Markdown syntax. */
const plain = (text: string) => text
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/(^|\s)(#{1,6}|>|[-*+])\s+/g, "$1")
  .replace(/\*\*|__|`/g, "")
  .replace(/\s+/g, " ")
  .trim()

function detail(item: EvidenceItem): string {
  const d = item.data
  const pick = (...keys: string[]) => keys.map((key) => d[key]).flat().filter((value) => value !== undefined && value !== null && value !== "").map(String)
  switch (item.kind) {
    case "course": return pick("code", "term", "grade").join(" · ")
    case "education": return pick("program", "gpa").join(" · ")
    case "project": return [...pick("summary").slice(0, 1).map(plain), pick("languages", "frameworks").slice(0, 5).join(", ")].filter(Boolean).join(" — ")
    case "experience": return [pick("org")[0], [pick("start")[0], pick("end")[0]].filter(Boolean).join("–")].filter(Boolean).join(" · ")
    case "certificate": return pick("issuer", "date").join(" · ")
    case "publication": return pick("venue", "year").join(" · ")
    default: return pick("summary", "context").join(" · ")
  }
}

interface EvidenceReviewProps {
  profile: StudentProfile
  onBack: () => void
  onNext: (confirmedTitles: string[]) => void
  /** Outside onboarding, only show items not reviewed yet. */
  onlyNew?: boolean
}

/** The student's explicit review: ticked items become facts, unticked ones are dismissed. */
export function EvidenceReview({ profile, onBack, onNext, onlyNew = false }: EvidenceReviewProps) {
  const { t } = useI18n()
  const [items, setItems] = useState<EvidenceItem[] | null>(null)
  const [sources, setSources] = useState<DataSourceItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const seen = useRef<Set<string>>(new Set())
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Suggestions are ticked by default; items that arrive later (a source still reading) are
  // ticked when they first appear, but never re-ticked after the student unticks them.
  const load = useCallback(async () => {
    const [all, nextSources] = await Promise.all([
      api<EvidenceItem[]>(`/api/students/${profile.student_id}/evidence`),
      api<DataSourceItem[]>(`/api/students/${profile.student_id}/sources`).catch((): DataSourceItem[] => []),
    ])
    const next = onlyNew ? all.filter((item) => item.status === "suggested") : all
    const fresh = next.filter((item) => !seen.current.has(item.id))
    fresh.forEach((item) => seen.current.add(item.id))
    setItems(next)
    setSources(nextSources.filter((source) => source.status !== "removed"))
    if (fresh.length) setSelected((current) => new Set([...current, ...fresh.map((item) => item.id)]))
  }, [profile.student_id, onlyNew])

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t("onboarding.review.loadFailed")))
  }, [load])

  const reading = sources.filter((source) => source.status === "syncing").length
  const failed = sources.filter((source) => source.status === "failed")
  useEffect(() => {
    if (!reading) return
    const timer = window.setInterval(() => { load().catch(() => undefined) }, 2000)
    return () => window.clearInterval(timer)
  }, [reading, load])

  // One section per source, so the student can tell where each suggestion came from.
  const sections = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id, source]))
    const order = [...sources.map((source) => source.id), ""]
    return order.map((id) => {
      const source = id ? byId.get(id) : undefined
      const own = (items ?? []).filter((item) => (byId.has(item.source_id) ? item.source_id : "") === id)
      const title = source ? (source.label && source.label !== source.kind ? `${sourceKindLabel(source.kind)} · ${isolate(source.label)}` : sourceKindLabel(source.kind)) : t("onboarding.review.yourSources")
      return { id: id || "other", title, groups: GROUPS.map((kind) => ({ kind, items: own.filter((item) => item.kind === kind) })).filter((group) => group.items.length), items: own }
    }).filter((section) => section.items.length)
  }, [items, sources, t])

  const setMany = (ids: string[], on: boolean) => setSelected((current) => {
    const next = new Set(current)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const confirm = async () => {
    if (!items) return
    setBusy(true); setError(null)
    try {
      const edited = Object.fromEntries(Object.entries(titles).filter(([id, title]) => selected.has(id) && title.trim()))
      await api(`/api/students/${profile.student_id}/evidence/decide`, {
        method: "POST",
        body: JSON.stringify({ confirm: [...selected], dismiss: items.filter((item) => !selected.has(item.id)).map((item) => item.id), titles: edited }),
      })
      onNext(items.filter((item) => selected.has(item.id)).map((item) => titles[item.id]?.trim() || item.title))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("onboarding.review.saveFailed"))
      setBusy(false)
    }
  }

  if (items === null) return <div className="grid flex-1 place-items-center p-8">{error ? <p className="text-sm text-destructive">{error}</p> : <LoaderCircle className="size-5 animate-spin text-muted-foreground" />}</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("onboarding.review.title")}</h1>
            <p className="mt-2 max-w-[62ch] text-[15px] text-muted-foreground">{t("onboarding.review.subtitle")}</p>
          </div>
          <span className="inline-flex min-h-7 items-center rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary">{t("onboarding.review.suggestions", { count: items.length })}</span>
        </div>
        <p className="mt-4 flex max-w-[78ch] items-start gap-2.5 rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{t("onboarding.review.howTo")}</span>
        </p>
        {reading ? (
          <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl border border-border px-4 py-3 text-[13px]"><LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />{t("onboarding.review.stillReading", { count: reading })}</p>
        ) : null}
        {failed.length ? (
          <div role="alert" className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px]">
            <p className="flex items-center gap-2 font-medium text-destructive"><AlertCircle className="size-4 shrink-0" aria-hidden="true" />{t("onboarding.review.failedSources", { count: failed.length })}</p>
            <ul className="mt-1 grid gap-0.5 text-muted-foreground">{failed.map((source) => <li key={source.id}><bdi>{source.label !== source.kind ? source.label : sourceKindLabel(source.kind)}</bdi>: {source.error}</li>)}</ul>
            <button type="button" onClick={onBack} className="mt-2 inline-flex min-h-8 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{t("onboarding.review.fixInSources")}</button>
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="mt-6 rounded-3xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">{onlyNew ? t("onboarding.review.emptyNew") : t("onboarding.review.empty")}</p>
        ) : (
          <section className="mt-6 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("onboarding.review.sourceCount", { selected: selected.size, total: items.length })}</p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setMany(items.map((item) => item.id), true)} className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring">{t("onboarding.review.selectAll")}</button>
                <button type="button" onClick={() => setMany(items.map((item) => item.id), false)} className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring">{t("onboarding.review.selectNone")}</button>
              </div>
            </div>
            <div className="grid gap-3">
              {sections.map((section) => (
                <section key={section.id} className="overflow-hidden rounded-2xl border border-border bg-background">
                  <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">{section.title}</strong>
                      <span className="text-xs text-muted-foreground">{t("onboarding.review.sourceCount", { selected: section.items.filter((item) => selected.has(item.id)).length, total: section.items.length })}</span>
                    </div>
                    <button type="button" className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setMany(section.items.map((item) => item.id), !section.items.every((item) => selected.has(item.id)))}>
                      {section.items.every((item) => selected.has(item.id)) ? t("onboarding.review.untickAll") : t("onboarding.review.tickAll")}
                    </button>
                  </div>
                  {section.groups.map((group) => (
                    <div key={group.kind} className="border-t border-border">
                      <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t(`onboarding.review.groups.${group.kind}`)}</p>
                      <ul className="divide-y divide-border">
                        {group.items.map((item) => (
                          <li key={item.id} className="px-4 py-3.5 transition-colors has-[input[type=checkbox]:not(:checked)]:bg-muted/40">
                            <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
                              <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={t("onboarding.review.keep", { title: isolate(item.title) })} className="mt-1 size-[22px] accent-[var(--primary)]" />
                              <div className="min-w-0">
                                <input dir="auto" value={titles[item.id] ?? item.title} onChange={(event) => setTitles((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={t("onboarding.review.name")} className={`w-full bg-transparent text-start text-sm font-medium outline-none focus:underline ${selected.has(item.id) ? "" : "text-muted-foreground line-through"}`} />
                                {detail(item) ? <span dir="auto" className="mt-0.5 block text-start text-xs text-muted-foreground">{detail(item)}</span> : null}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
            <div className="sticky bottom-4 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-full border border-border bg-background/90 py-2 ps-5 pe-2 shadow-lg backdrop-blur">
              <p className="text-xs text-muted-foreground"><strong className="text-foreground">{t("onboarding.review.selected", { count: selected.size })}</strong><br />{t("onboarding.review.editableLater")}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onBack} className="inline-flex h-11 items-center rounded-full px-4 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{onlyNew ? t("onboarding.back") : t("onboarding.review.addMore")}</button>
                <button type="button" disabled={busy} onClick={() => void confirm()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{busy ? t("onboarding.saving") : items.length ? t("onboarding.review.keepAndContinue", { count: selected.size }) : t("onboarding.continue")}</button>
              </div>
            </div>
          </section>
        )}
        {items.length === 0 ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={onBack} className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{onlyNew ? t("onboarding.review.backToSources") : t("onboarding.review.addMoreSources")}</button>
            <button type="button" disabled={busy} onClick={() => void confirm()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? t("onboarding.saving") : t("onboarding.continue")}</button>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
