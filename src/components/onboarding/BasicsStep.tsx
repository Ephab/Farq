"use client"

import { useEffect, useState } from "react"
import { api, type Discipline, type StudentProfile } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

interface BasicsStepProps {
  profile: StudentProfile
  onSaved: (profile: StudentProfile) => void
}

const FIELDS = ["institution", "program", "year_label", "grad_target"] as const

export function BasicsStep({ profile, onSaved }: BasicsStepProps) {
  const { t } = useI18n()
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
      setError(reason instanceof Error ? reason.message : t("onboarding.basics.saveFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl p-4 sm:p-8">
      <h1 className="text-lg font-semibold">{t("onboarding.basics.title", { name: profile.display_name })}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.basics.subtitle")}</p>
      <div className="mt-6 space-y-4">
        {FIELDS.map((field) => (
          <div key={field}>
            <label htmlFor={`basics-${field}`} className="block text-xs font-medium">{t(`onboarding.basics.fields.${field}.label`)}</label>
            <input id={`basics-${field}`} dir="auto" value={values[field]} placeholder={t(`onboarding.basics.fields.${field}.placeholder`)} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
          </div>
        ))}
        <div>
          <label htmlFor="basics-discipline" className="block text-xs font-medium">{t("onboarding.basics.discipline")}</label>
          <select id="basics-discipline" value={discipline ?? ""} onChange={(event) => setDiscipline(event.target.value || null)} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">{t("onboarding.basics.detect")}</option>
            {disciplines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("onboarding.basics.disciplineHint")}</p>
        </div>
      </div>
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      <button type="button" disabled={busy || !values.program.trim()} onClick={() => void save()} className="mt-6 h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? t("onboarding.saving") : t("onboarding.continue")}</button>
    </div>
  )
}
