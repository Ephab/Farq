"use client"

import { useCallback, useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { AlertCircle, ArrowRight, BookOpen, Briefcase, CheckCircle2, FileText, FolderSearch, Globe, GraduationCap, Link2, LoaderCircle, Trash2, UserRound, type LucideIcon } from "lucide-react"
import { api, hermesRequestParts, uploadSourceFile, type DataSourceItem, type Discipline, type EvidenceItem, type SourceKind, type StudentProfile } from "@/lib/farq-api"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

interface SourceMeta {
  title: string
  description: string
  icon: LucideIcon
  input: "file" | "text"
  accept?: string
  placeholder?: string
}

const SOURCE_META: Record<SourceKind, SourceMeta> = {
  transcript_pdf: { title: "Transcript", description: "Courses, grades, and experience.", icon: GraduationCap, input: "file", accept: "application/pdf" },
  cv_pdf: { title: "CV / resume", description: "A PDF of your CV. Works for every major.", icon: FileText, input: "file", accept: "application/pdf" },
  linkedin_zip: { title: "LinkedIn data export", description: "LinkedIn → Settings → Data privacy → Get a copy of your data. Upload the ZIP; it's parsed here without a model.", icon: Briefcase, input: "file", accept: ".zip,application/zip" },
  linkedin_pdf: { title: "LinkedIn profile PDF", description: "Profile and work history. On your LinkedIn profile: More → Save to PDF.", icon: UserRound, input: "file", accept: "application/pdf" },
  github: { title: "GitHub", description: "Projects and repositories can add concrete evidence to roadmap topics.", icon: Link2, input: "text", placeholder: "username or github.com/username" },
  folder: { title: "Project folder", description: "Read only a path you type on this computer.", icon: FolderSearch, input: "text", placeholder: "Full path, e.g. D:\\Projects or D:\\University" },
  portfolio_url: { title: "Portfolio", description: "One public page describing your work.", icon: Globe, input: "text", placeholder: "https://…" },
  orcid: { title: "ORCID", description: "Publications and affiliations.", icon: BookOpen, input: "text", placeholder: "0000-0000-0000-0000" },
}

interface SourcesStepProps {
  profile: StudentProfile
  onBack: () => void
  onNext: () => void
  title?: string
  backLabel?: string
}

type KindStatus = "ready" | "reading" | "failed" | "idle"

function kindStatus(items: DataSourceItem[]): KindStatus {
  if (items.some((source) => source.status === "syncing")) return "reading"
  if (items.some((source) => source.status === "ready")) return "ready"
  if (items.some((source) => source.status === "failed" || source.status === "pending")) return "failed"
  return "idle"
}

export function SourcesStep({ profile, onBack, onNext, title = "Add records to your plan.", backLabel = "Back" }: SourcesStepProps) {
  const [discipline, setDiscipline] = useState<Discipline | null>(null)
  const [sources, setSources] = useState<DataSourceItem[]>([])
  const [suggested, setSuggested] = useState(0)
  const reduce = useReducedMotion()

  const refresh = useCallback(async () => {
    const [nextSources, evidence] = await Promise.all([
      api<DataSourceItem[]>(`/api/students/${profile.student_id}/sources`),
      api<EvidenceItem[]>(`/api/students/${profile.student_id}/evidence`).catch((): EvidenceItem[] => []),
    ])
    setSources(nextSources)
    setSuggested(evidence.filter((item) => item.status === "suggested").length)
  }, [profile.student_id])

  useEffect(() => {
    api<Discipline[]>("/api/disciplines").then((items) => setDiscipline(items.find((item) => item.id === profile.discipline) ?? items[items.length - 1])).catch(() => undefined)
    refresh().catch(() => undefined)
  }, [profile.discipline, refresh])

  const kinds = discipline?.sources ?? []
  const featuredKind: SourceKind | null = kinds.includes("github") ? "github" : (kinds[0] ?? null)
  const otherKinds = kinds.filter((kind) => kind !== featuredKind)
  const busy = sources.some((source) => source.status === "syncing")

  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="w-full px-4 py-6 sm:px-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-[62ch] text-[15px] text-muted-foreground">Start with the source most likely to change your next milestone. Everything is reviewed before it counts.</p>
          </div>
          <motion.button
            type="button"
            onClick={onNext}
            whileTap={reduce ? undefined : { scale: 0.98 }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold shadow-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {suggested ? `Review ${suggested} new suggestion${suggested === 1 ? "" : "s"}` : "Review suggestions"}
            <ArrowRight className="size-4" />
          </motion.button>
        </div>

        <div className="mt-7 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px] lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            {featuredKind ? (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
                className="grid items-center gap-4 rounded-2xl bg-gradient-to-br from-primary/10 to-transparent p-5 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recommended</p>
                  <h2 className="mt-1 text-[17px] font-semibold tracking-tight">{SOURCE_META[featuredKind].title}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{SOURCE_META[featuredKind].description}</p>
                </div>
                <SourceAction kind={featuredKind} studentId={profile.student_id} active={sources.filter((source) => source.kind === featuredKind && source.status !== "removed")} onChange={refresh} featured />
              </motion.div>
            ) : null}

            <h2 className="mb-3 mt-6 text-[19px] font-semibold tracking-tight">Other records</h2>
            <div className="grid gap-2.5">
              {otherKinds.map((kind, index) => {
                const meta = SOURCE_META[kind]
                const Icon = meta.icon
                const active = sources.filter((source) => source.kind === kind && source.status !== "removed")
                const status = kindStatus(active)
                return (
                  <motion.div
                    key={kind}
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.25), ease: EASE_OUT }}
                    className="rounded-2xl border border-border bg-background p-3 shadow-sm"
                  >
                    <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
                      <span className="grid size-10 place-items-center rounded-[13px] bg-muted text-foreground"><Icon className="size-4" /></span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm font-semibold">{meta.title}</strong>
                          <StatusPill status={status} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta.description}</span>
                      </span>
                      <SourceAction kind={kind} studentId={profile.student_id} active={active} onChange={refresh} compact />
                    </div>
                    <SourceStatusList kind={kind} items={active} studentId={profile.student_id} onChange={refresh} />
                  </motion.div>
                )
              })}
            </div>

            {discipline && discipline.coming_soon.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border p-4">
                <p className="text-xs font-medium">Coming soon for {discipline.label.toLowerCase()}</p>
                <p className="mt-1 text-xs text-muted-foreground">{discipline.coming_soon.join(" · ")}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <button type="button" onClick={onBack} className="inline-flex h-10 items-center rounded-full px-4 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{backLabel}</button>
              {busy ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Wait for sources that are still reading…</span> : null}
            </div>
          </section>

          <aside className="grid items-start gap-4">
            <motion.section
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
              className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6"
            >
              <h2 className="text-[17px] font-semibold tracking-tight">Import status</h2>
              <div className="mt-3 grid gap-2">
                {kinds.length === 0 ? <p className="text-[13px] text-muted-foreground">Loading sources…</p> : null}
                {kinds.map((kind) => {
                  const active = sources.filter((source) => source.kind === kind && source.status !== "removed")
                  const status = kindStatus(active)
                  const readyCount = active.filter((source) => source.status === "ready").length
                  return (
                    <div key={kind} className="grid gap-1 rounded-2xl bg-muted/50 p-3">
                      <strong className="text-[13px] font-semibold">{SOURCE_META[kind].title}</strong>
                      <span className="text-xs text-muted-foreground">
                        {status === "ready" ? `✓ Ready${readyCount > 1 ? ` · ${readyCount} connected` : ""}` : status === "reading" ? "Reading…" : status === "failed" ? "Needs attention" : "Not added"}
                      </span>
                    </div>
                  )
                })}
              </div>
            </motion.section>
          </aside>
        </div>
      </motion.div>
    </div>
  )
}

function StatusPill({ status }: { status: KindStatus }) {
  if (status === "ready") return <span className="inline-flex min-h-7 items-center rounded-full bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">✓ Ready</span>
  if (status === "reading") return <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-700 dark:text-amber-400"><LoaderCircle className="size-3 animate-spin" />Reading</span>
  if (status === "failed") return <span className="inline-flex min-h-7 items-center rounded-full bg-red-500/10 px-2.5 text-xs font-semibold text-red-600 dark:text-red-400">Needs a check</span>
  return <span className="inline-flex min-h-7 items-center rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground">Not added</span>
}

/** Compact per-source status rows with remove actions. */
function SourceStatusList({ kind, items, studentId, onChange }: { kind: SourceKind; items: DataSourceItem[]; studentId: string; onChange: () => Promise<void> }) {
  if (!items.length) return null
  const remove = async (source: DataSourceItem) => {
    await api(`/api/students/${studentId}/sources/${source.id}`, { method: "DELETE" }).catch(() => undefined)
    await onChange()
  }
  return (
    <div className="mt-2 grid gap-1.5">
      {items.map((source) => (
        <div key={source.id} className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs">
          {source.status === "ready" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : source.status === "failed" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{source.label !== source.kind ? source.label : SOURCE_META[kind].title}{source.config.purpose ? ` · ${source.config.purpose}` : ""}</p>
            <p className="text-muted-foreground">{source.status === "ready" ? "Read successfully" : source.status === "failed" ? source.error : source.status === "pending" ? "Not read yet — remove and try again" : kind === "folder" ? "Hermes is indexing this folder…" : "Reading…"}</p>
          </div>
          <button type="button" aria-label="Remove source" onClick={() => void remove(source)} className="text-muted-foreground hover:text-foreground"><Trash2 className="size-3.5" /></button>
        </div>
      ))}
    </div>
  )
}

/** The add/choose control for one source kind: featured, compact, or standalone. */
function SourceAction({ kind, studentId, active, onChange, featured = false, compact = false }: { kind: SourceKind; studentId: string; active: DataSourceItem[]; onChange: () => Promise<void>; featured?: boolean; compact?: boolean }) {
  const meta = SOURCE_META[kind]
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

  if (meta.input === "file") {
    return (
      <div className={cn(featured && "justify-self-start sm:justify-self-end")}>
        <label className={cn("inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full px-5 text-sm font-semibold shadow-sm outline-none transition focus-within:ring-2 focus-within:ring-ring", featured ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card hover:bg-muted", working && "pointer-events-none opacity-40")}>
          {working ? "Reading…" : active.length ? "Choose another" : featured ? "Choose a PDF →" : "Choose"}
          <input type="file" accept={meta.accept} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(file) }} />
        </label>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  if (compact) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={meta.placeholder} aria-label={meta.title} onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !working) void run() }} className="h-9 w-28 rounded-xl border border-border bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:w-36" />
          <button type="button" disabled={!value.trim() || working} onClick={() => void run()} className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{working ? "…" : "Add"}</button>
        </div>
        {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={meta.placeholder} aria-label={meta.title} onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !working) void run() }} className="h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
        {kind === "folder" ? (
          <select value={purpose} onChange={(event) => setPurpose(event.target.value as "projects" | "coursework")} aria-label="What is in this folder" className="h-11 rounded-2xl border border-border bg-background px-3 text-sm">
            <option value="projects">Projects</option>
            <option value="coursework">Coursework</option>
          </select>
        ) : null}
        <button type="button" disabled={!value.trim() || working} onClick={() => void run()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{working ? "Reading…" : "Connect →"}</button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <SourceStatusList kind={kind} items={active} studentId={studentId} onChange={onChange} />
    </div>
  )
}
