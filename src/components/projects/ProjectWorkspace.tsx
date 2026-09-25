"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Bot, CheckCircle2, FolderOpen, GitBranch as Github, LoaderCircle, Play, RotateCcw, ShieldCheck, Upload } from "lucide-react"
import { api, type FarqProject, type ProjectEvaluation } from "@/lib/farq-api"
import { cn } from "@/lib/utils"

type SourceType = "github" | "local_directory"

export function ProjectWorkspace({ project, onBack, onRefresh, onAskHermes }: { project: FarqProject; onBack: () => void; onRefresh: () => void; onAskHermes: (prompt: string) => void }) {
  const [tab, setTab] = useState<"brief" | "refine" | "submit" | "evaluations">("brief")
  const [sourceType, setSourceType] = useState<SourceType>("github")
  const [sourceRef, setSourceRef] = useState("")
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const newestDraft = project.draft_revisions[0]
  const activeEvaluation = project.evaluations.find((item) => item.status === "queued" || item.status === "running")

  useEffect(() => {
    if (!activeEvaluation) return
    const timer = window.setInterval(onRefresh, 2000)
    return () => window.clearInterval(timer)
  }, [activeEvaluation, onRefresh])

  const latest = project.evaluations[0]
  const rubricTotal = useMemo(() => project.brief.rubric.reduce((total, item) => total + item.weight, 0), [project.brief.rubric])

  const evaluate = async () => {
    setBusy(true); setError(null)
    try {
      const submission = await api<{ id: string }>(`/api/projects/${project.id}/submissions`, { method: "POST", body: JSON.stringify({ source_type: sourceType, source_ref: sourceRef, manifest: {} }) })
      await api(`/api/projects/${project.id}/evaluations`, { method: "POST", body: JSON.stringify({ submission_id: submission.id }) })
      setTab("evaluations"); onRefresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start evaluation") }
    finally { setBusy(false) }
  }

  const acceptDraft = async () => {
    if (!newestDraft) return
    setBusy(true); setError(null)
    try {
      await api(`/api/projects/${project.id}/refinements/${newestDraft.id}/accept`, { method: "POST" })
      onRefresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this project revision") }
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload this project") }
    finally { setBusy(false) }
  }

  return <div className="mx-auto w-full max-w-6xl p-4 sm:p-8">
    <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All projects</button>
    <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{project.discipline} · {project.lifecycle.replace("-", " ")}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{project.title}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{project.brief.objective}</p></div>
      {project.latest_score !== null ? <div className="rounded-2xl border border-border px-5 py-3 text-center shadow-sm"><p className="text-3xl font-semibold tabular-nums">{project.latest_score}%</p><p className="text-xs text-muted-foreground">Latest · best {project.best_score}%</p></div> : null}
    </div>
    <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {(["brief", "refine", "submit", "evaluations"] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={cn("min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold capitalize", tab === item ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{item}</button>)}
    </div>
    {error ? <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600">{error}</p> : null}

    {tab === "submit" ? <section className="mt-5 rounded-2xl border border-dashed border-border p-5"><p className="text-sm font-semibold">Upload a ZIP snapshot</p><p className="mt-1 text-xs text-muted-foreground">Maximum 100 MB. Unsafe paths and secret-like files are rejected or filtered.</p><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input type="file" accept=".zip,application/zip" onChange={(event) => setZipFile(event.target.files?.[0] ?? null)} className="min-w-0 flex-1 text-sm" /><button type="button" disabled={!zipFile || busy} onClick={() => void evaluateZip()} className="h-10 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50">Upload and evaluate</button></div></section> : null}

    {tab === "brief" ? <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-border p-6 shadow-sm"><h2 className="text-xl font-semibold">The project</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{project.brief.problem}</p><h3 className="mt-6 text-sm font-semibold">Deliverables</h3><ul className="mt-2 space-y-2">{project.brief.deliverables.map((item) => <li key={item} className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />{item}</li>)}</ul><h3 className="mt-6 text-sm font-semibold">Milestones</h3><ol className="mt-2 space-y-2">{project.brief.milestones.map((item, index) => <li key={item} className="flex gap-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>{item}</li>)}</ol></section>
      <aside className="rounded-2xl border border-border p-6 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Evaluation rubric</h2><span className="text-xs text-muted-foreground">{rubricTotal}%</span></div><div className="mt-4 space-y-4">{project.brief.rubric.map((item) => <div key={item.id}><div className="flex justify-between gap-3 text-sm font-semibold"><span>{item.title}</span><span>{item.weight}%</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p></div>)}</div></aside>
    </div> : null}

    {tab === "refine" ? <section className="mt-5 rounded-2xl border border-border p-8 text-center shadow-sm"><Bot className="mx-auto size-8 text-primary" /><h2 className="mt-3 text-xl font-semibold">Make this idea yours</h2><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Discuss the audience, scope, tools, deliverables, and rubric with Hermes. Hermes creates a draft; nothing changes until you explicitly save it.</p>{newestDraft ? <div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-5 text-left"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hermes draft · revision {newestDraft.version}</p><h3 className="mt-1 text-lg font-semibold">{newestDraft.brief.title}</h3><p className="mt-2 text-sm text-muted-foreground">{newestDraft.brief.objective}</p><button type="button" disabled={busy} onClick={() => void acceptDraft()} className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save to roadmap"}</button></div> : null}<button type="button" onClick={() => onAskHermes(`Help me refine project ${project.id}: ${project.title}. Load the farq-project-coach skill and begin by asking what would make me care about building it.`)} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"><Bot className="size-4" />{newestDraft ? "Keep refining with Hermes" : "Refine with Hermes"}</button></section> : null}

    {tab === "submit" ? <section className="mt-5 rounded-2xl border border-border p-6 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h2 className="text-xl font-semibold">Evaluate the real artifact</h2></div><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Farq snapshots your project and evaluates it in an isolated environment. A completed evaluation marks this milestone done; the rating remains separate.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{([{ type: "github", label: "Public GitHub repository", icon: Github }, { type: "local_directory", label: "Local project directory", icon: FolderOpen }] as const).map((option) => <button key={option.type} type="button" onClick={() => setSourceType(option.type)} className={cn("flex items-center gap-3 rounded-xl border p-4 text-left", sourceType === option.type ? "border-primary bg-primary/5" : "border-border")}><option.icon className="size-5" /><span className="text-sm font-semibold">{option.label}</span></button>)}</div><label className="mt-5 block text-sm font-semibold">{sourceType === "github" ? "Repository URL" : "Absolute directory path"}<input value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} placeholder={sourceType === "github" ? "https://github.com/you/project" : "D:\\Projects\\my-project"} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label><button type="button" disabled={busy || !sourceRef.trim()} onClick={() => void evaluate()} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}{busy ? "Queueing…" : "Start automatic evaluation"}</button><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Upload className="size-3.5" />ZIP and browser directory upload are available through the evaluator worker intake.</p></section> : null}

    {tab === "evaluations" ? <section className="mt-5 space-y-4">{project.evaluations.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No evaluation attempts yet.</div> : project.evaluations.map((evaluation: ProjectEvaluation) => <article key={evaluation.id} className="rounded-2xl border border-border p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{evaluation.adapter} · {evaluation.coverage} coverage</p><h2 className="mt-1 text-lg font-semibold">{evaluation.status === "completed" ? evaluation.report?.summary ?? "Evaluation complete" : evaluation.stage}</h2></div>{evaluation.score !== null ? <span className="text-3xl font-semibold tabular-nums">{evaluation.score}%</span> : <LoaderCircle className="size-5 animate-spin text-muted-foreground" />}</div>{evaluation.report ? <div className="mt-5 grid gap-4 md:grid-cols-2"><div><h3 className="text-sm font-semibold">Strengths</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{evaluation.report.strengths.map((item) => <li key={item}>• {item}</li>)}</ul></div><div><h3 className="text-sm font-semibold">Improve next</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{evaluation.report.improvements.map((item) => <li key={item}>• {item}</li>)}</ul></div></div> : null}</article>)}</section> : null}
    {latest?.status === "completed" ? <button type="button" onClick={() => setTab("submit")} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"><RotateCcw className="size-4" />Retake evaluation</button> : null}
  </div>
}
