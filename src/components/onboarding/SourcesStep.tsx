"use client"

import { OutlookView } from "@/components/outlook/OutlookView"

import { useCallback, useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { AlertCircle, ArrowRight, BookOpen, Briefcase, CheckCircle2, FileText, FolderSearch, Globe, GraduationCap, Info, Link2, LoaderCircle, RotateCcw, Trash2, UserRound, type LucideIcon } from "lucide-react"
import { api, hermesRequestParts, uploadSourceFile, type DataSourceItem, type Discipline, type EvidenceItem, type SourceKind, type StudentProfile, sourceKindLabel } from "@/lib/waypoint-api"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

interface SourceMeta {
  icon: LucideIcon
  input: "file" | "text"
  accept?: string
  placeholderKey?: MessageKey
  /** Literal machine-format example, shown as-is in every language. */
  placeholder?: string
}

const IS_WINDOWS = typeof navigator !== "undefined" && /Win/i.test(navigator.platform ?? "")

// Titles come from sourceKindLabel(); descriptions from onboarding.sources.descriptions.*.
const SOURCE_META: Record<SourceKind, SourceMeta> = {
  transcript_pdf: { icon: GraduationCap, input: "file", accept: "application/pdf" },
  cv_pdf: { icon: FileText, input: "file", accept: "application/pdf" },
  linkedin_zip: { icon: Briefcase, input: "file", accept: ".zip,application/zip" },
  linkedin_pdf: { icon: UserRound, input: "file", accept: "application/pdf" },
  github: { icon: Link2, input: "text", placeholderKey: "onboarding.sources.placeholders.github" },
  folder: { icon: FolderSearch, input: "text", placeholderKey: IS_WINDOWS ? "onboarding.sources.placeholders.folderWin" : "onboarding.sources.placeholders.folderPosix" },
  portfolio_url: { icon: Globe, input: "text", placeholder: "https://…" },
  orcid: { icon: BookOpen, input: "text", placeholder: "0000-0000-0000-0000" },
}

const PURPOSE_KEYS: Record<string, MessageKey> = {
  projects: "onboarding.sources.purpose.projects",
  coursework: "onboarding.sources.purpose.coursework",
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

export function SourcesStep({ profile, onBack, onNext, title, backLabel }: SourcesStepProps) {
  const { t, fmt } = useI18n()
  const [discipline, setDiscipline] = useState<Discipline | null>(null)
  const [sources, setSources] = useState<DataSourceItem[]>([])
  const [suggested, setSuggested] = useState(0)
  const [counts, setCounts] = useState<Record<string, SourceCounts>>({})
  const reduce = useReducedMotion()

  const refresh = useCallback(async () => {
    const [nextSources, evidence] = await Promise.all([
      api<DataSourceItem[]>(`/api/students/${profile.student_id}/sources`),
      api<EvidenceItem[]>(`/api/students/${profile.student_id}/evidence`).catch((): EvidenceItem[] => []),
    ])
    setSources(nextSources)
    setSuggested(evidence.filter((item) => item.status === "suggested").length)
    const next: Record<string, SourceCounts> = {}
    for (const item of evidence) {
      const count = (next[item.source_id] ??= { suggested: 0, reviewed: 0 })
      if (item.status === "suggested") count.suggested += 1
      else count.reviewed += 1
    }
    setCounts(next)
  }, [profile.student_id])

  useEffect(() => {
    api<Discipline[]>("/api/disciplines").then((items) => setDiscipline(items.find((item) => item.id === profile.discipline) ?? items[items.length - 1])).catch(() => undefined)
    refresh().catch(() => undefined)
  }, [profile.discipline, refresh])

  const kinds = discipline?.sources ?? []
  const featuredKind: SourceKind | null = kinds.includes("github") ? "github" : (kinds[0] ?? null)
  const otherKinds = kinds.filter((kind) => kind !== featuredKind)
  const busy = sources.some((source) => source.status === "syncing")

  // Reads run on the server in the background: poll while any source is working so the student
  // sees each stage and the result without pressing anything.
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => { refresh().catch(() => undefined) }, 1500)
    return () => window.clearInterval(timer)
  }, [busy, refresh])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="w-full px-4 py-6 sm:px-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title ?? t("onboarding.sources.title")}</h1>
            <p className="mt-2 max-w-[62ch] text-[15px] text-muted-foreground">{t("onboarding.sources.subtitle")}</p>
          </div>
          <motion.button
            type="button"
            onClick={onNext}
            whileTap={reduce ? undefined : { scale: 0.98 }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold shadow-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {suggested ? t("onboarding.sources.reviewNew", { count: suggested }) : t("onboarding.sources.reviewSuggestions")}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </motion.button>
        </div>

        <p className="mt-5 flex max-w-[78ch] items-start gap-2.5 rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold text-foreground">{t("onboarding.sources.nextTitle")}.</strong> {t("onboarding.sources.nextBody")}</span>
        </p>

        <details className="mt-6 rounded-2xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t("onboarding.sources.outlook")}</summary>
          <OutlookView />
        </details>
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("onboarding.sources.recommended")}</p>
                  <h2 className="mt-1 text-[17px] font-semibold tracking-tight">{sourceKindLabel(featuredKind)}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{t(`onboarding.sources.descriptions.${featuredKind}`)}</p>
                </div>
                <SourceAction kind={featuredKind} studentId={profile.student_id} active={sources.filter((source) => source.kind === featuredKind && source.status !== "removed")} onChange={refresh} featured />
              </motion.div>
            ) : null}
            {featuredKind ? (
              <SourceStatusList kind={featuredKind} items={sources.filter((source) => source.kind === featuredKind && source.status !== "removed")} studentId={profile.student_id} counts={counts} onChange={refresh} />
            ) : null}

            <h2 className="mb-3 mt-6 text-[19px] font-semibold tracking-tight">{t("onboarding.sources.otherRecords")}</h2>
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
                          <strong className="text-sm font-semibold">{sourceKindLabel(kind)}</strong>
                          <StatusPill status={status} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t(`onboarding.sources.descriptions.${kind}`)}</span>
                      </span>
                      <SourceAction kind={kind} studentId={profile.student_id} active={active} onChange={refresh} compact />
                    </div>
                    <SourceStatusList kind={kind} items={active} studentId={profile.student_id} counts={counts} onChange={refresh} />
                  </motion.div>
                )
              })}
            </div>

            {discipline && discipline.coming_soon.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border p-4">
                <p className="text-xs font-medium">{t("onboarding.sources.comingSoon", { discipline: discipline.label.toLowerCase() })}</p>
                <p className="mt-1 text-xs text-muted-foreground">{discipline.coming_soon.join(" · ")}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <button type="button" onClick={onBack} className="inline-flex h-10 items-center rounded-full px-4 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{backLabel ?? t("onboarding.back")}</button>
              {busy ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{t("onboarding.sources.waitReading")}</span> : null}
            </div>
          </section>

          <aside className="grid items-start gap-4">
            <motion.section
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
              className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6"
            >
              <h2 className="text-[17px] font-semibold tracking-tight">{t("onboarding.sources.importStatus")}</h2>
              <div className="mt-3 grid gap-2">
                {kinds.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("onboarding.sources.loadingSources")}</p> : null}
                {kinds.map((kind) => {
                  const active = sources.filter((source) => source.kind === kind && source.status !== "removed")
                  const status = kindStatus(active)
                  const readyCount = active.filter((source) => source.status === "ready").length
                  return (
                    <div key={kind} className="grid gap-1 rounded-2xl bg-muted/50 p-3">
                      <strong className="text-[13px] font-semibold">{sourceKindLabel(kind)}</strong>
                      <span className="text-xs text-muted-foreground">
                        {status === "ready" ? (readyCount > 1 ? t("onboarding.sources.readyConnected", { count: fmt.number(readyCount) }) : t("onboarding.sources.readyShort")) : status === "reading" ? t("onboarding.sources.readingEllipsis") : status === "failed" ? t("onboarding.sources.needsAttention") : t("onboarding.sources.notAdded")}
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
  const { t } = useI18n()
  if (status === "ready") return <span className="inline-flex min-h-7 items-center rounded-full bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t("onboarding.sources.readyShort")}</span>
  if (status === "reading") return <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-700 dark:text-amber-400"><LoaderCircle className="size-3 animate-spin" />{t("onboarding.sources.reading")}</span>
  if (status === "failed") return <span className="inline-flex min-h-7 items-center rounded-full bg-red-500/10 px-2.5 text-xs font-semibold text-red-600 dark:text-red-400">{t("onboarding.sources.needsCheck")}</span>
  return <span className="inline-flex min-h-7 items-center rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground">{t("onboarding.sources.notAdded")}</span>
}

function stageText(source: DataSourceItem, kind: SourceKind, t: ReturnType<typeof useI18n>["t"]): string {
  if (source.stage === "extracting" && (source.progress?.total ?? 0) > 1) return t("onboarding.sources.stage.extractingParts", { done: Math.min((source.progress?.done ?? 0) + 1, source.progress?.total ?? 1), total: source.progress?.total ?? 1 })
  if (source.stage === "extracting") return kind === "folder" ? t("onboarding.sources.indexingFolder") : t("onboarding.sources.stage.extracting")
  if (source.stage === "saving") return t("onboarding.sources.stage.saving")
  if (source.stage === "queued") return t("onboarding.sources.stage.queued")
  return t("onboarding.sources.stage.reading")
}

/** Progress for one source that is being read: stage, a bar, elapsed time and what to expect. */
function SyncingDetail({ source, kind }: { source: DataSourceItem; kind: SourceKind }) {
  const { t, fmt } = useI18n()
  const elapsed = Math.round(source.elapsed_seconds ?? 0)
  const total = source.progress?.total ?? 0
  const percent = source.stage === "extracting" && total > 1 ? Math.max(8, Math.round(((source.progress?.done ?? 0) / total) * 100)) : null
  return (
    <div role="status" aria-live="polite" className="mt-1 grid gap-1.5">
      <p className="text-foreground">{stageText(source, kind, t)} <span className="text-muted-foreground">· {t("onboarding.sources.elapsed", { seconds: fmt.number(elapsed) })}</span></p>
      <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <p className="text-muted-foreground">{elapsed > 45 ? t("onboarding.sources.slow") : kind === "folder" ? t("onboarding.sources.usuallyFolder") : t("onboarding.sources.usually")}</p>
    </div>
  )
}

/** Compact per-source status rows with retry and remove actions. */
/** Evidence per source: still waiting for review, and already confirmed or dismissed. */
type SourceCounts = { suggested: number; reviewed: number }

function SourceStatusList({ kind, items, studentId, counts, onChange }: { kind: SourceKind; items: DataSourceItem[]; studentId: string; counts: Record<string, SourceCounts>; onChange: () => Promise<void> }) {
  const { t } = useI18n()
  const [rowError, setRowError] = useState<string | null>(null)
  if (!items.length) return null
  const remove = async (source: DataSourceItem) => {
    setRowError(null)
    try {
      await api(`/api/students/${studentId}/sources/${source.id}`, { method: "DELETE" })
    } catch (reason) {
      setRowError(reason instanceof Error ? reason.message : t("onboarding.sources.remove"))
    }
    await onChange()
  }
  const retry = async (source: DataSourceItem, file?: File) => {
    setRowError(null)
    try {
      if (file) {
        await uploadSourceFile(studentId, source.id, file, { background: true })
      } else {
        const { body, headers } = hermesRequestParts()
        await api(`/api/students/${studentId}/sources/${source.id}/sync?background=true`, { method: "POST", body: JSON.stringify(body), headers })
      }
    } catch (reason) {
      setRowError(reason instanceof Error ? reason.message : t("onboarding.sources.readFailed"))
    }
    await onChange().catch(() => undefined)
  }
  const isFile = SOURCE_META[kind].input === "file"
  return (
    <div className="mt-2 grid gap-1.5">
      {items.map((source) => {
        const { suggested: found, reviewed } = counts[source.id] ?? { suggested: 0, reviewed: 0 }
        return (
          <div key={source.id} className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs">
            {source.status === "ready" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : source.status === "failed" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium"><bdi>{source.label !== source.kind ? source.label : sourceKindLabel(kind)}</bdi>{source.config.purpose ? ` · ${PURPOSE_KEYS[String(source.config.purpose)] ? t(PURPOSE_KEYS[String(source.config.purpose)]) : source.config.purpose}` : ""}</p>
              {source.status === "syncing" ? <SyncingDetail source={source} kind={kind} /> : (
                <p className={source.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                  {source.status === "ready" ? (found || !reviewed ? t("onboarding.sources.found", { count: found }) : t("onboarding.sources.reviewed", { count: reviewed })) : source.status === "failed" ? source.error : t("onboarding.sources.notReadYet")}
                </p>
              )}
              {source.status === "ready" && source.note ? <p className="text-amber-700 dark:text-amber-400">{source.note}</p> : null}
              {source.status === "failed" || source.status === "pending" ? (
                isFile ? (
                  <label className="mt-1.5 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 font-semibold outline-none transition hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
                    <RotateCcw className="size-3" aria-hidden="true" />{t("onboarding.sources.chooseAgain")}
                    <input type="file" accept={SOURCE_META[kind].accept} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void retry(source, file) }} />
                  </label>
                ) : (
                  <button type="button" onClick={() => void retry(source)} className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                    <RotateCcw className="size-3" aria-hidden="true" />{t("onboarding.sources.retry")}
                  </button>
                )
              ) : null}
            </div>
            <button type="button" aria-label={t("onboarding.sources.remove")} onClick={() => void remove(source)} className="-m-1.5 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><Trash2 className="size-3.5" aria-hidden="true" /></button>
          </div>
        )
      })}
      {rowError ? <p role="alert" className="text-xs text-destructive">{rowError}</p> : null}
    </div>
  )
}

/** The add/choose control for one source kind: featured, compact, or standalone. */
function SourceAction({ kind, studentId, active, onChange, featured = false, compact = false }: { kind: SourceKind; studentId: string; active: DataSourceItem[]; onChange: () => Promise<void>; featured?: boolean; compact?: boolean }) {
  const { t } = useI18n()
  const meta = SOURCE_META[kind]
  const placeholder = meta.placeholderKey ? t(meta.placeholderKey) : meta.placeholder
  const [value, setValue] = useState("")
  const [purpose, setPurpose] = useState<"projects" | "coursework">("projects")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Usernames, paths, URLs and IDs read left-to-right once typed; the empty field keeps the localized placeholder direction.
  const inputDir = value ? "ltr" : undefined

  const run = async (file?: File) => {
    setWorking(true); setError(null)
    try {
      const source = await api<DataSourceItem>(`/api/students/${studentId}/sources`, {
        method: "POST",
        body: JSON.stringify({ kind, value: file ? "" : value, ...(kind === "folder" ? { purpose } : {}) }),
      })
      // Background: the request returns at once and the list polls progress, so a slow model never freezes the form.
      await onChange().catch(() => undefined)
      if (file) {
        await uploadSourceFile(studentId, source.id, file, { background: true })
      } else {
        const { body, headers } = hermesRequestParts()
        await api(`/api/students/${studentId}/sources/${source.id}/sync?background=true`, { method: "POST", body: JSON.stringify(body), headers })
      }
      setValue("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("onboarding.sources.readFailed"))
    } finally {
      setWorking(false)
      await onChange().catch(() => undefined)
    }
  }

  if (meta.input === "file") {
    return (
      <div className={cn(featured && "justify-self-start sm:justify-self-end")}>
        <label className={cn("inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full px-5 text-sm font-semibold shadow-sm outline-none transition focus-within:ring-2 focus-within:ring-ring", featured ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card hover:bg-muted", working && "pointer-events-none opacity-40")}>
          {working ? t("onboarding.sources.readingEllipsis") : active.length ? t("onboarding.sources.chooseAnother") : featured ? t("onboarding.sources.choosePdf") : t("onboarding.sources.choose")}
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
          <input value={value} onChange={(event) => setValue(event.target.value)} dir={inputDir} placeholder={placeholder} title={placeholder} aria-label={sourceKindLabel(kind)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !working) void run() }} className="h-9 w-40 rounded-xl border border-border bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:w-48" />
          <button type="button" disabled={!value.trim() || working} onClick={() => void run()} className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{working ? "…" : t("onboarding.sources.add")}</button>
        </div>
        {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={value} onChange={(event) => setValue(event.target.value)} dir={inputDir} placeholder={placeholder} aria-label={sourceKindLabel(kind)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !working) void run() }} className="h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
        {kind === "folder" ? (
          <select value={purpose} onChange={(event) => setPurpose(event.target.value as "projects" | "coursework")} aria-label={t("onboarding.sources.folderPurpose")} className="h-11 rounded-2xl border border-border bg-background px-3 text-sm">
            <option value="projects">{t("onboarding.sources.purpose.projects")}</option>
            <option value="coursework">{t("onboarding.sources.purpose.coursework")}</option>
          </select>
        ) : null}
        <button type="button" disabled={!value.trim() || working} onClick={() => void run()} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{working ? t("onboarding.sources.readingEllipsis") : t("onboarding.sources.connect")}</button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
