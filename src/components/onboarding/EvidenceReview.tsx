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
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
      <h1 className="text-lg font-semibold">Is this you?</h1>
      <p className="mt-1 text-sm text-muted-foreground">Untick anything that's wrong or not your work, and fix names if needed. Only what you keep is saved to your profile.</p>
      {items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">{onlyNew ? "No new items to review. Add a source first." : "Nothing to review. That's fine: Hermes will ask you a few more questions instead."}</p>
      ) : (
        <div className="mt-6 space-y-6">
          {grouped.map((group) => (
            <section key={group.kind}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{group.label} <span className="font-normal text-muted-foreground">({group.items.filter((item) => selected.has(item.id)).length}/{group.items.length})</span></h2>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected((current) => {
                  const next = new Set(current)
                  const allOn = group.items.every((item) => next.has(item.id))
                  for (const item of group.items) { if (allOn) next.delete(item.id); else next.add(item.id) }
                  return next
                })}>{group.items.every((item) => selected.has(item.id)) ? "Untick all" : "Tick all"}</button>
              </div>
              <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Keep ${item.title}`} className="mt-1 size-4 accent-[var(--primary)]" />
                    <div className="min-w-0 flex-1">
                      <input value={titles[item.id] ?? item.title} onChange={(event) => setTitles((current) => ({ ...current, [item.id]: event.target.value }))} aria-label="Name" className={`w-full bg-transparent text-sm font-medium outline-none focus:underline ${selected.has(item.id) ? "" : "text-muted-foreground line-through"}`} />
                      {detail(item) ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{detail(item)}</p> : null}
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">From {item.source_ref || "your sources"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={onBack} className="h-10 rounded-xl border border-border px-4 text-sm">{onlyNew ? "Back to sources" : "Add more sources"}</button>
        <button type="button" disabled={busy} onClick={() => void confirm()} className="h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : items.length ? `Keep ${selected.size} and continue` : "Continue"}</button>
      </div>
    </div>
  )
}
