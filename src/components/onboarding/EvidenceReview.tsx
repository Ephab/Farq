"use client"

import { useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { api, type EvidenceItem, type StudentProfile } from "@/lib/farq-api"

const GROUPS: { kind: string; label: string }[] = [
  { kind: "education", label: "Education" },
  { kind: "course", label: "Courses & grades" },
  { kind: "project", label: "Projects" },
  { kind: "experience", label: "Experience" },
  { kind: "skill", label: "Skills" },
  { kind: "certificate", label: "Certificates" },
  { kind: "publication", label: "Publications" },
  { kind: "activity", label: "Activities & honors" },
]

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
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load evidence"))
  }, [profile.student_id, onlyNew])

  const grouped = useMemo(() => GROUPS.map((group) => ({ ...group, items: (items ?? []).filter((item) => item.kind === group.kind) })).filter((group) => group.items.length), [items])

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
      setError(reason instanceof Error ? reason.message : "Could not save your review")
      setBusy(false)
    }
  }

  if (items === null) return <div className="grid flex-1 place-items-center p-8">{error ? <p className="text-sm text-destructive">{error}</p> : <LoaderCircle className="size-5 animate-spin text-muted-foreground" />}</div>

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review the new records.</h1>
            <p className="mt-2 max-w-[62ch] text-[15px] text-muted-foreground">These suggestions can update future roadmap milestones. Your current work will not change.</p>
          </div>
          <span className="inline-flex min-h-7 items-center rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary">{items.length} suggestion{items.length === 1 ? "" : "s"}</span>
        </div>
        {items.length === 0 ? (
          <p className="mt-6 rounded-3xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">{onlyNew ? "No new items to review. Add a source first." : "Nothing to review. That's fine: Hermes will ask you a few more questions instead."}</p>
        ) : (
          <section className="mt-6 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="grid gap-3">
              {grouped.map((group) => (
                <section key={group.kind} className="overflow-hidden rounded-2xl border border-border bg-background">
                  <div className="flex min-h-[54px] items-center justify-between gap-3 px-4">
                    <strong className="text-sm">{group.label}</strong>
                    <span className="inline-flex min-h-7 items-center rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary">{group.items.filter((item) => selected.has(item.id)).length} selected</span>
                  </div>
                  <ul className="divide-y divide-border border-t border-border">
                    {group.items.map((item) => (
                      <li key={item.id} className="px-4 py-3.5 transition-colors has-[:not(:checked)]:bg-muted/40">
                        <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
                          <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Keep ${item.title}`} className="mt-1 size-[22px] accent-[var(--primary)]" />
                          <div className="min-w-0">
                            <input value={titles[item.id] ?? item.title} onChange={(event) => setTitles((current) => ({ ...current, [item.id]: event.target.value }))} aria-label="Name" className={`w-full bg-transparent text-sm font-medium outline-none focus:underline ${selected.has(item.id) ? "" : "text-muted-foreground line-through"}`} />
                            {detail(item) ? <span className="mt-0.5 block text-xs text-muted-foreground">{detail(item)}</span> : null}
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">From {item.source_ref || "your sources"}</span>
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
                    })}>{group.items.every((item) => selected.has(item.id)) ? "Untick all" : "Tick all"}</button>
                  </div>
                </section>
              ))}
            </div>
            <div className="sticky bottom-4 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-full border border-border bg-background/90 py-2 pl-5 pr-2 shadow-lg backdrop-blur">
              <p className="text-xs text-muted-foreground"><strong className="text-foreground">{selected.size} selected</strong><br />These facts remain editable later.</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onBack} className="inline-flex h-11 items-center rounded-full px-4 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{onlyNew ? "Back" : "Add more"}</button>
                <button type="button" disabled={busy} onClick={() => void confirm()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{busy ? "Saving…" : items.length ? `Keep ${selected.size} and continue →` : "Continue"}</button>
              </div>
            </div>
          </section>
        )}
        {items.length === 0 ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={onBack} className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{onlyNew ? "Back to sources" : "Add more sources"}</button>
            <button type="button" disabled={busy} onClick={() => void confirm()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : "Continue"}</button>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
