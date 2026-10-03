import { CheckCircle2, XCircle } from "lucide-react"
import type { ProjectEvaluation, ProjectBrief } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

export function EvaluationReport({ report, rubric, evaluationId }: { evaluationId: string; report: NonNullable<ProjectEvaluation["report"]>; rubric: ProjectBrief["rubric"] }) {
  const { t } = useI18n()
  return <div className="mt-5 space-y-6">
    <div className="grid gap-4 md:grid-cols-2">
      <div><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.strengths")}</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{report.strengths.map((item, index) => <li key={index} dir="auto">{"\u2022"} {item}</li>)}</ul></div>
      <div><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.improve")}</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{report.improvements.map((item, index) => <li key={index} dir="auto">{"\u2022"} {item}</li>)}</ul></div>
    </div>
    <section className="space-y-3"><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.rubric")}</h3>{report.criteria.map(criterion => <div key={criterion.criterion_id} className="rounded-xl border border-border p-4">
      <div className="flex justify-between gap-4"><h4 dir="auto" className="font-medium">{rubric.find(item => item.id === criterion.criterion_id)?.title ?? criterion.criterion_id}</h4><span className="shrink-0 tabular-nums">{criterion.score}/100</span></div>
      <p dir="auto" className="mt-2 text-sm text-muted-foreground">{criterion.feedback}</p>
      <div className="mt-2 flex flex-wrap gap-2">{criterion.evidence.map((id, index) => report.observations?.some(item => item.id === id) ? <a key={index} href={`#evidence-${evaluationId}-${id}`} className="rounded bg-muted px-2 py-1 text-xs underline">{id}</a> : <span key={index} dir="auto" className="text-xs text-muted-foreground">{id}</span>)}</div>
    </div>)}</section>
    {report.observations?.length ? <section className="space-y-2"><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.checks")}</h3>{report.observations.map(check => <details key={check.id} id={`evidence-${evaluationId}-${check.id}`} className="rounded-xl border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm">{check.passed ? <CheckCircle2 className="size-4 shrink-0 text-green-600" /> : <XCircle className="size-4 shrink-0 text-destructive" />}<span dir="auto" className="flex-1">{check.title}</span><span className="text-xs text-muted-foreground">{check.id} {"\u00b7"} {(check.duration_ms / 1000).toFixed(1)}s</span></summary>
      <pre dir="ltr" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{check.output}</pre>
    </details>)}</section> : null}
    {report.screenshots?.length ? <section><h3 className="mb-3 text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.screenshots")}</h3><div className="grid gap-4 md:grid-cols-2">{report.screenshots.map(shot => <figure key={shot.id}><a href={`data:image/png;base64,${shot.png_base64}`} download={`${shot.id}.png`}><img src={`data:image/png;base64,${shot.png_base64}`} alt={shot.title} className="max-h-96 w-full rounded-lg border border-border object-contain object-top" loading="lazy" /></a><figcaption dir="auto" className="mt-2 text-xs text-muted-foreground">{shot.title}</figcaption></figure>)}</div></section> : null}
    {report.limitations.length ? <section className="rounded-xl bg-muted p-4"><h3 className="text-sm font-semibold">{t("dashboard.projects.workspace.evaluations.limitations")}</h3><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{report.limitations.map((item, index) => <li key={index} dir="auto">{"\u2022"} {item}</li>)}</ul></section> : null}
  </div>
}
