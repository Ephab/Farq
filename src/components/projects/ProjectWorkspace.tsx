"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Bot, CheckCircle2, FolderOpen, GitBranch as Github, LoaderCircle, Play, RotateCcw, ShieldCheck, Upload } from "lucide-react"
import { api, type WaypointProject, type ProjectEvaluation } from "@/lib/waypoint-api"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"

type SourceType = "github" | "local_directory"
const IS_WINDOWS = typeof navigator !== "undefined" && /Win/i.test(navigator.platform ?? "")

export function ProjectWorkspace({ project, onBack, onRefresh, onAskHermes }: { project: WaypointProject; onBack: () => void; onRefresh: () => void; onAskHermes: (prompt: string) => void }) {
  const { t, fmt } = useI18n()
  const [tab, setTab] = useState<"brief" | "refine" | "submit" | "evaluations">("brief")
  const [sourceType, setSourceType] = useState<SourceType>("github")
  const [sourceRef, setSourceRef] = useState("")
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const newestDraft = project.draft_revisions[0]
  const activeEvaluation = project.evaluations.find((item) => item.status === "queued" || item.status === "running")

  // The parent passes a new onRefresh each render; keep the interval steady instead of restarting it.
  const refreshRef = useRef(onRefresh)
  useEffect(() => { refreshRef.current = onRefresh }, [onRefresh])
  const activeEvaluationId = activeEvaluation?.id
  useEffect(() => {
    if (!activeEvaluationId) return
    const timer = window.setInterval(() => refreshRef.current(), 3000)
    return () => window.clearInterval(timer)
  }, [activeEvaluationId])

  const latest = project.evaluations[0]
  const rubricTotal = useMemo(() => project.brief.rubric.reduce((total, item) => total + item.weight, 0), [project.brief.rubric])

  const evaluate = async () => {
    setBusy(true); setError(null)
    try {
      const submission = await api<{ id: string }>(`/api/projects/${project.id}/submissions`, { method: "POST", body: JSON.stringify({ source_type: sourceType, source_ref: sourceRef, manifest: {} }) })
      await api(`/api/projects/${project.id}/evaluations`, { method: "POST", body: JSON.stringify({ submission_id: submission.id }) })
      setTab("evaluations"); onRefresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("dashboard.projects.workspace.errors.evaluate")) }
    finally { setBusy(false) }
  }

  const acceptDraft = async () => {
    if (!newestDraft) return
    setBusy(true); setError(null)
    try {
      await api(`/api/projects/${project.id}/refinements/${newestDraft.id}/accept`, { method: "POST" })
      onRefresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("dashboard.projects.workspace.errors.save")) }
    finally { setBusy(false) }
  }

  const evaluateZip = async () => {
    if (!zipFile) return
    setBusy(true); setError(null)
    try {
      const form = new FormData(); form.append("file", zipFile)
      const submission = await api<{ id: string }>(`/api/projects/${project.id}/submissions/upload`, { method: "POST", body: form })
      await api(`/api/projects/${project.id}/evaluations`, { method: "POST", body: JSON.stringify({ submission_id: submission.id }) })
      setTab("evaluations"); onRefresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("dashboard.projects.workspace.errors.upload")) }
    finally { setBusy(false) }
  }

  return <div className="mx-auto w-full max-w-6xl p-4 sm:p-8">
    <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />{t("dashboard.projects.workspace.allProjects")}</button>
    <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><bdi>{project.discipline}</bdi> · {t(`dashboard.projects.workspace.lifecycle.${project.lifecycle}`)}</p><h1 dir="auto" className="mt-1 text-start text-3xl font-semibold tracking-tight sm:text-4xl">{project.title}</h1><p dir="auto" className="mt-2 max-w-3xl text-start text-sm text-muted-foreground">{project.brief.objective}</p></div>
      {project.latest_score !== null ? <div className="rounded-2xl border border-border px-5 py-3 text-center shadow-sm"><p className="text-3xl font-semibold tabular-nums">{fmt.percent(project.latest_score / 100)}</p><p className="text-xs text-muted-foreground">{t("dashboard.projects.workspace.latestBest", { best: project.best_score === null ? "—" : fmt.percent(project.best_score / 100) })}</p></div> : null}
    </div>
    <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" role="tablist">
      {(["brief", "refine", "submit", "evaluations"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={cn("min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === item ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(`dashboard.projects.workspace.tabs.${item}`)}</button>)}
    </div>
    {error ? <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600">{error}</p> : null}

    {tab === "submit" ? <section className="mt-5 rounded-2xl border border-dashed border-border p-5"><p className="text-sm font-semibold">{t("dashboard.projects.workspace.zip.title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("dashboard.projects.workspace.zip.hint")}</p><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input type="file" accept=".zip,application/zip" onChange={(event) => setZipFile(event.target.files?.[0] ?? null)} className="min-w-0 flex-1 text-sm" /><button type="button" disabled={!zipFile || busy} onClick={() => void evaluateZip()} className="h-10 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50">{t("dashboard.projects.workspace.zip.submit")}</button></div></section> : null}

    {tab === "brief" ? <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-border p-6 shadow-sm"><h2 className="text-xl font-semibold">{t("dashboard.projects.workspace.brief.project")}</h2><p dir="auto" className="mt-3 text-start text-sm leading-6 text-muted-foreground">{project.brief.problem}</p><h3 className="mt-6 text-sm font-semibold">{t("dashboard.projects.workspace.brief.deliverables")}</h3><ul className="mt-2 space-y-2">{project.brief.deliverables.map((item, index) => <li key={index} className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /><bdi>{item}</bdi></li>)}</ul><h3 className="mt-6 text-sm font-semibold">{t("dashboard.projects.workspace.brief.milestones")}</h3><ol className="mt-2 space-y-2">{project.brief.milestones.map((item, index) => <li key={index} className="flex gap-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{fmt.number(index + 1)}</span><bdi>{item}</bdi></li>)}</ol></section>
      <aside className="rounded-2xl border border-border p-6 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t("dashboard.projects.workspace.brief.rubric")}</h2><span className="text-xs text-muted-foreground">{fmt.percent(rubricTotal / 100)}</span></div><div className="mt-4 space-y-4">{project.brief.rubric.map((item) => <div key={item.id}><div className="flex justify-between gap-3 text-sm font-semibold"><bdi>{item.title}</bdi><span>{fmt.percent(item.weight / 100)}</span></div><p dir="auto" className="mt-1 text-start text-xs leading-5 text-muted-foreground">{item.description}</p></div>)}</div></aside>
    </div> : null}

    {tab === "refine" ? <section className="mt-5 rounded-2xl border border-border p-8 text-center shadow-sm"><Bot className="mx-auto size-8 text-primary" /><h2 className="mt-3 text-xl font-semibold">{t("dashboard.projects.workspace.refine.title")}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{t("dashboard.projects.workspace.refine.body")}</p>{newestDraft ? <div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-5 text-start"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("dashboard.projects.workspace.refine.draft", { version: newestDraft.version })}</p><h3 dir="auto" className="mt-1 text-start text-lg font-semibold">{newestDraft.brief.title}</h3><p dir="auto" className="mt-2 text-start text-sm text-muted-foreground">{newestDraft.brief.objective}</p><button type="button" disabled={busy} onClick={() => void acceptDraft()} className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? t("dashboard.projects.workspace.refine.saving") : t("dashboard.projects.workspace.refine.save")}</button></div> : null}<button type="button" onClick={() => onAskHermes(t("dashboard.projects.workspace.refine.prompt", { id: project.id, title: project.title }))} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"><Bot className="size-4" />{newestDraft ? t("dashboard.projects.workspace.refine.keepRefining") : t("dashboard.projects.workspace.refine.refine")}</button></section> : null}

    {tab === "submit" ? <section className="mt-5 rounded-2xl border border-border p-6 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h2 className="text-xl font-semibold">{t("dashboard.projects.workspace.submit.title")}</h2></div><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("dashboard.projects.workspace.submit.body")}</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{([{ type: "github", label: "dashboard.projects.workspace.submit.github", icon: Github }, { type: "local_directory", label: "dashboard.projects.workspace.submit.local", icon: FolderOpen }] as const).map((option) => <button key={option.type} type="button" onClick={() => setSourceType(option.type)} className={cn("flex items-center gap-3 rounded-xl border p-4 text-start", sourceType === option.type ? "border-primary bg-primary/5" : "border-border")}><option.icon className="size-5" /><span className="text-sm font-semibold">{t(option.label)}</span></button>)}</div><label className="mt-5 block text-sm font-semibold">{sourceType === "github" ? t("dashboard.projects.workspace.submit.repoUrl") : t("dashboard.projects.workspace.submit.dirPath")}<input dir="ltr" value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} placeholder={sourceType === "github" ? "https://github.com/you/project" : IS_WINDOWS ? "D:\\Projects\\my-project" : "/Users/you/Projects/my-project"} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label><button type="button" disabled={busy || !sourceRef.trim()} onClick={() => void evaluate()} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}{busy ? t("dashboard.projects.workspace.submit.queueing") : t("dashboard.projects.workspace.submit.start")}</button><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Upload className="size-3.5" />{t("dashboard.projects.workspace.submit.intake")}</p></section> : null}

    {tab === "evaluations" ? <section className="mt-5 space-y-4">{project.evaluations.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("dashboard.projects.workspace.evaluations.none")}</div> : project.evaluations.map((evaluation: ProjectEvaluation) => <article key={evaluation.id} className="rounded-2xl border border-border p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t(`dashboard.projects.workspace.evaluations.coverage.${evaluation.coverage}`, { adapter: "\u2068" + evaluation.adapter + "\u2069" })}</p><h2 dir="auto" className="mt-1 text-start text-lg font-semibold">{evaluation.status === "completed" ? evaluation.report?.summary ?? t("dashboard.projects.workspace.evaluations.complete") : evaluation.status === "failed" ? t("dashboard.projects.workspace.evaluations.failed") : evaluation.stage}</h2>{evaluation.status === "failed" && evaluation.error ? <p dir="auto" className="mt-1 text-start text-sm text-destructive">{evaluation.error}</p> : null}</div>{evaluation.score !== null ? <span className="text-3xl font-semibold tabular-nums">{fmt.percent(evaluation.score / 100)}</span> : evaluation.status === "failed" ? null : <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label={t("common.loading")} />}</div>{evaluation.report ? <div className="mt-5 grid gap-4 md:grid-cols-2"><div><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.strengths")}</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{evaluation.report.strengths.map((item, index) => <li key={index} dir="auto" className="text-start">• {item}</li>)}</ul></div><div><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.improve")}</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{evaluation.report.improvements.map((item, index) => <li key={index} dir="auto" className="text-start">• {item}</li>)}</ul></div></div> : null}</article>)}</section> : null}
    {latest?.status === "completed" || latest?.status === "failed" ? <button type="button" onClick={() => setTab("submit")} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"><RotateCcw className="size-4" />{t("dashboard.projects.workspace.evaluations.retake")}</button> : null}
  </div>
}
