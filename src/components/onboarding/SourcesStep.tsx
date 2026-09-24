"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, BookOpen, Briefcase, CheckCircle2, FileText, FolderSearch, Globe, GraduationCap, Link2, LoaderCircle, Trash2, UserRound, type LucideIcon } from "lucide-react"
import { api, hermesRequestParts, uploadSourceFile, type DataSourceItem, type Discipline, type SourceKind, type StudentProfile } from "@/lib/farq-api"

interface SourceMeta {
  title: string
  description: string
  icon: LucideIcon
  input: "file" | "text"
  accept?: string
  placeholder?: string
}

const SOURCE_META: Record<SourceKind, SourceMeta> = {
  transcript_pdf: { title: "Transcript", description: "Your official transcript PDF. Farq reads courses and grades; ID numbers, emails and phone numbers are masked before Hermes sees it.", icon: GraduationCap, input: "file", accept: "application/pdf" },
  cv_pdf: { title: "CV / resume", description: "A PDF of your CV. Works for every major.", icon: FileText, input: "file", accept: "application/pdf" },
  linkedin_zip: { title: "LinkedIn data export", description: "LinkedIn → Settings → Data privacy → Get a copy of your data. Upload the ZIP; it's parsed here without a model.", icon: Briefcase, input: "file", accept: ".zip,application/zip" },
  linkedin_pdf: { title: "LinkedIn profile PDF", description: "On your LinkedIn profile: More → Save to PDF.", icon: UserRound, input: "file", accept: "application/pdf" },
  github: { title: "GitHub", description: "Public repositories, languages, topics and activity.", icon: Link2, input: "text", placeholder: "username or github.com/username" },
  folder: { title: "Folder on this computer", description: "Hermes indexes it on this machine. It never opens .env files, keys or ID documents, and skips dependency folders.", icon: FolderSearch, input: "text", placeholder: "Full path, e.g. D:\\Projects or D:\\University" },
  portfolio_url: { title: "Portfolio website", description: "One public https:// page describing your work.", icon: Globe, input: "text", placeholder: "https://…" },
  orcid: { title: "ORCID", description: "Publications and affiliations for research-active students.", icon: BookOpen, input: "text", placeholder: "0000-0000-0000-0000" },
}

interface SourcesStepProps {
  profile: StudentProfile
  onBack: () => void
  onNext: () => void
  title?: string
  backLabel?: string
}

export function SourcesStep({ profile, onBack, onNext, title = "Connect what you already have", backLabel = "Back" }: SourcesStepProps) {
  const [discipline, setDiscipline] = useState<Discipline | null>(null)
  const [sources, setSources] = useState<DataSourceItem[]>([])

  const refresh = useCallback(async () => {
    setSources(await api<DataSourceItem[]>(`/api/students/${profile.student_id}/sources`))
  }, [profile.student_id])

  useEffect(() => {
    api<Discipline[]>("/api/disciplines").then((items) => setDiscipline(items.find((item) => item.id === profile.discipline) ?? items[items.length - 1])).catch(() => undefined)
    refresh().catch(() => undefined)
  }, [profile.discipline, refresh])

  const busy = sources.some((source) => source.status === "syncing")
  const ready = sources.filter((source) => source.status === "ready").length

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every source is optional. Add the ones you have and skip the rest; you'll review everything we find before it's saved.</p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {(discipline?.sources ?? []).map((kind) => (
          <SourceCard key={kind} kind={kind} studentId={profile.student_id} sources={sources.filter((source) => source.kind === kind && source.status !== "removed")} onChange={refresh} />
        ))}
      </div>
      {discipline && discipline.coming_soon.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-4">
          <p className="text-xs font-medium">Coming soon for {discipline.label.toLowerCase()}</p>
          <p className="mt-1 text-xs text-muted-foreground">{discipline.coming_soon.join(" · ")}</p>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="h-10 rounded-xl border border-border px-4 text-sm">{backLabel}</button>
        <button type="button" disabled={busy} onClick={onNext} className="h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-40">{ready ? "Review what we found" : "Skip for now"}</button>
        {busy ? <span className="text-xs text-muted-foreground">Wait for sources that are still reading…</span> : null}
      </div>
    </div>
  )
}

function SourceCard({ kind, studentId, sources, onChange }: { kind: SourceKind; studentId: string; sources: DataSourceItem[]; onChange: () => Promise<void> }) {
  const meta = SOURCE_META[kind]
  const Icon = meta.icon
  const [value, setValue] = useState("")
  const [purpose, setPurpose] = useState<"projects" | "coursework">("projects")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (file?: File) => {
    setWorking(true); setError(null)
    try {
      const source = await api<DataSourceItem>(`/api/students/${studentId}/sources`, {
        method: "POST",
        body: JSON.stringify({ kind, value: file ? "" : value, ...(kind === "folder" ? { purpose } : {}) }),
      })
      if (file) {
        await uploadSourceFile(studentId, source.id, file)
      } else {
        const { body, headers } = hermesRequestParts()
        await api(`/api/students/${studentId}/sources/${source.id}/sync`, { method: "POST", body: JSON.stringify(body), headers })
      }
      setValue("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read this source")
    } finally {
      setWorking(false)
      await onChange().catch(() => undefined)
    }
  }

  const remove = async (source: DataSourceItem) => {
    await api(`/api/students/${studentId}/sources/${source.id}`, { method: "DELETE" }).catch(() => undefined)
    await onChange()
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><Icon className="size-4" /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{meta.title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{meta.description}</p>
        </div>
      </div>
      {sources.map((source) => (
        <div key={source.id} className="mt-3 flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs">
          {source.status === "ready" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : source.status === "failed" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{source.label !== source.kind ? source.label : meta.title}{source.config.purpose ? ` · ${source.config.purpose}` : ""}</p>
            <p className="text-muted-foreground">{source.status === "ready" ? "Read successfully" : source.status === "failed" ? source.error : source.status === "pending" ? "Not read yet — remove and try again" : kind === "folder" ? "Hermes is indexing this folder…" : "Reading…"}</p>
          </div>
          <button type="button" aria-label="Remove source" onClick={() => void remove(source)} className="text-muted-foreground hover:text-foreground"><Trash2 className="size-3.5" /></button>
        </div>
      ))}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {meta.input === "file" ? (
          <label className={`inline-flex h-9 cursor-pointer items-center rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted ${working ? "pointer-events-none opacity-40" : ""}`}>
            {working ? "Reading…" : sources.length ? "Upload another" : "Choose file"}
            <input type="file" accept={meta.accept} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(file) }} />
          </label>
        ) : (
          <>
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={meta.placeholder} aria-label={meta.title} className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
            {kind === "folder" ? (
              <select value={purpose} onChange={(event) => setPurpose(event.target.value as "projects" | "coursework")} aria-label="What is in this folder" className="h-9 rounded-xl border border-border bg-background px-2 text-xs">
                <option value="projects">Projects</option>
                <option value="coursework">Coursework</option>
              </select>
            ) : null}
            <button type="button" disabled={!value.trim() || working} onClick={() => void run()} className="h-9 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40">{working ? "Reading…" : "Add"}</button>
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
