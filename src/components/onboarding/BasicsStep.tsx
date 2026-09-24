"use client"

import { useEffect, useState } from "react"
import { api, type Discipline, type StudentProfile } from "@/lib/farq-api"

interface BasicsStepProps {
  profile: StudentProfile
  onSaved: (profile: StudentProfile) => void
}

const FIELDS = [
  { key: "institution", label: "University", placeholder: "e.g. Your university" },
  { key: "program", label: "Program / major", placeholder: "e.g. BSc Artificial Intelligence, MBBS, LLB, Civil Engineering" },
  { key: "year_label", label: "Where you are now", placeholder: "e.g. Year 4, 7th semester" },
  { key: "grad_target", label: "Expected graduation", placeholder: "e.g. June 2027" },
] as const

export function BasicsStep({ profile, onSaved }: BasicsStepProps) {
  const [values, setValues] = useState({ institution: profile.institution, program: profile.program, year_label: profile.year_label, grad_target: profile.grad_target })
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [discipline, setDiscipline] = useState<string | null>(profile.program ? profile.discipline : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { api<Discipline[]>("/api/disciplines").then(setDisciplines).catch(() => undefined) }, [])

  const save = async () => {
    setBusy(true); setError(null)
    try {
      // Without an explicit pick the server classifies the program text.
      const body = { ...values, ...(discipline ? { discipline } : {}), onboarding_status: "sources" }
      onSaved(await api<StudentProfile>(`/api/students/${profile.student_id}/profile`, { method: "PUT", body: JSON.stringify(body) }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl p-4 sm:p-8">
      <h1 className="text-lg font-semibold">Hi {profile.display_name}, tell us the basics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everything else comes from your documents and projects on the next step.</p>
      <div className="mt-6 space-y-4">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`basics-${field.key}`} className="block text-xs font-medium">{field.label}</label>
            <input id={`basics-${field.key}`} value={values[field.key]} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
          </div>
        ))}
        <div>
          <label htmlFor="basics-discipline" className="block text-xs font-medium">Field of study</label>
          <select id="basics-discipline" value={discipline ?? ""} onChange={(event) => setDiscipline(event.target.value || null)} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">Detect from my program</option>
            {disciplines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">This decides which sources we suggest and how your roadmap is shaped.</p>
        </div>
      </div>
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      <button type="button" disabled={busy || !values.program.trim()} onClick={() => void save()} className="mt-6 h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : "Continue"}</button>
    </div>
  )
}
