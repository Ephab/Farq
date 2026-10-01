"use client"

import { useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { api, type EvidenceItem, type StudentProfile } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

const GROUPS = ["education", "course", "project", "experience", "skill", "certificate", "publication", "activity"] as const

/** Unicode first-strong isolate: keeps a file name or title from reordering the sentence around it. */
const isolate = (text: string) => `⁨${text}⁩`

function detail(item: EvidenceItem): string {
  const d = item.data
  const pick = (...keys: string[]) => keys.map((key) => d[key]).flat().filter((value) => value !== undefined && value !== null && value !== "").map(String)
  switch (item.kind) {
    case "course": return pick("code", "term", "grade").join(" · ")
    case "education": return pick("program", "gpa").join(" · ")
    case "project": return [...pick("summary").slice(0, 1), pick("languages", "frameworks").slice(0, 5).join(", ")].filter(Boolean).join(" — ")
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<EvidenceItem[]>(`/api/students/${profile.student_id}/evidence`).then((all) => {
      const next = onlyNew ? all.filter((item) => item.status === "suggested") : all
      setItems(next)
      setSelected(new Set(next.map((item) => item.id)))
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t("onboarding.review.loadFailed")))
  }, [profile.student_id, onlyNew])

  const grouped = useMemo(() => GROUPS.map((kind) => ({ kind, items: (items ?? []).filter((item) => item.kind === kind) })).filter((group) => group.items.length), [items])

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
        {items.length === 0 ? (
          <p className="mt-6 rounded-3xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">{onlyNew ? t("onboarding.review.emptyNew") : t("onboarding.review.empty")}</p>
        ) : (
          <section className="mt-6 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="grid gap-3">
              {grouped.map((group) => (
                <section key={group.kind} className="overflow-hidden rounded-2xl border border-border bg-background">
                  <div className="flex min-h-[54px] items-center justify-between gap-3 px-4">
                    <strong className="text-sm">{t(`onboarding.review.groups.${group.kind}`)}</strong>
                    <span className="inline-flex min-h-7 items-center rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary">{t("onboarding.review.selected", { count: group.items.filter((item) => selected.has(item.id)).length })}</span>
                  </div>
                  <ul className="divide-y divide-border border-t border-border">
                    {group.items.map((item) => (
                      <li key={item.id} className="px-4 py-3.5 transition-colors has-[input[type=checkbox]:not(:checked)]:bg-muted/40">
                        <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
                          <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={t("onboarding.review.keep", { title: isolate(item.title) })} className="mt-1 size-[22px] accent-[var(--primary)]" />
                          <div className="min-w-0">
                            <input dir="auto" value={titles[item.id] ?? item.title} onChange={(event) => setTitles((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={t("onboarding.review.name")} className={`w-full bg-transparent text-start text-sm font-medium outline-none focus:underline ${selected.has(item.id) ? "" : "text-muted-foreground line-through"}`} />
                            {detail(item) ? <span dir="auto" className="mt-0.5 block text-start text-xs text-muted-foreground">{detail(item)}</span> : null}
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">{t("onboarding.review.from", { source: item.source_ref ? isolate(item.source_ref) : t("onboarding.review.yourSources") })}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-end border-t border-border px-4 py-2">
                    <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setSelected((current) => {
                      const next = new Set(current)
                      const allOn = group.items.every((item) => next.has(item.id))
                      for (const item of group.items) { if (allOn) next.delete(item.id); else next.add(item.id) }
                      return next
                    })}>{group.items.every((item) => selected.has(item.id)) ? t("onboarding.review.untickAll") : t("onboarding.review.tickAll")}</button>
                  </div>
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
