import { useEffect, useState } from "react"
import { ChevronLeft, Download, LoaderCircle } from "lucide-react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { blackboardFileTitle, type BlackboardCollection as Collection, type CourseStatus } from "@/lib/blackboard-catalog"
import { useI18n } from "@/lib/i18n/context"
import { BlackboardFiles } from "@/components/slides/BlackboardFiles"

export function BlackboardCollection({ onClose, syncedAt }: { onClose: () => void; syncedAt?: string | null }) {
  const { t, fmt } = useI18n()
  const [data, setData] = useState<Collection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [term, setTerm] = useState("")
  const [status, setStatus] = useState("")
  const [tab, setTab] = useState<"courses" | "files" | "events" | "diagnostics" | "records">("courses")
  useEffect(() => {
    let active = true
    api<Collection>(`/api/students/${getCurrentStudentId()}/blackboard/collection`)
      .then((v) => { if (active) setData(v) }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)) })
    return () => { active = false }
  }, [syncedAt])
  const terms = [...new Set(data?.courses.map((c) => c.term || c.term_id) || [])].sort().reverse()
  const courses = data?.courses.filter((c) => (!term || (c.term || c.term_id) === term) && (!status || c.status === status)
    && `${c.title} ${c.code} ${c.term}`.toLowerCase().includes(query.toLowerCase())) || []
  const files = data?.courses.flatMap((c) => c.files) || []
  function exportData() {
    if (!data) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
    const link = document.createElement("a"); link.href = url; link.download = "blackboard-collection.json"; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="mt-5 border-t border-border pt-5">
    <div className="flex flex-wrap items-center gap-3"><button onClick={onClose} className="flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="size-4 rtl:rotate-180" />{t("blackboard.collection.close")}</button>
      <h3 className="flex-1 text-lg font-semibold">{t("blackboard.collection.title")}</h3>
      <button onClick={exportData} disabled={!data} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"><Download className="size-4" />{t("blackboard.collection.export")}</button></div>
    <p className="mt-2 text-sm text-muted-foreground">{t("blackboard.collection.hint")}</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {!data && !error && <LoaderCircle className="mt-4 size-5 animate-spin" />}
    {data && <>
      {!data.has_file_catalog && <p className="mt-3 rounded-xl bg-muted p-3 text-sm">{t("blackboard.collection.resync")}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{([
        ["courses", data.courses.length], ["records", data.courses.reduce((n, c) => n + c.items.length, 0)],
        ["files", files.length], ["grades", data.courses.reduce((n, c) => n + c.grades.length, 0)],
      ] as const).map(([key, value]) => <div key={key} className="rounded-xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t(`blackboard.stats.${key}`)}</p><p className="text-xl font-semibold">{fmt.number(value)}</p></div>)}</div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t("blackboard.collection.title")}>{(["courses", "files", "events", "diagnostics", "records"] as const).map((v) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`rounded-full px-3 py-2 text-sm ${tab === v ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{t(`blackboard.collection.${v}`)}</button>)}</div>
      {tab === "courses" && <>
        <div className="mt-4 flex flex-wrap gap-2"><input aria-label={t("blackboard.collection.search")} placeholder={t("blackboard.collection.search")} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 basis-full rounded-xl border bg-background px-3 py-2 text-sm sm:flex-1 sm:basis-48" />
          <select aria-label={t("blackboard.collection.term")} value={term} onChange={(e) => setTerm(e.target.value)} className="max-w-full rounded-xl border bg-background px-3 py-2 text-sm"><option value="">{t("blackboard.collection.allTerms")}</option>{terms.map((v) => <option key={v} value={v}>{v || t("blackboard.collection.unknownTerm")}</option>)}</select>
          <select aria-label={t("blackboard.collection.status")} value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm"><option value="">{t("blackboard.collection.allStatuses")}</option>{(["current", "past", "upcoming", "completed", "unknown"] as CourseStatus[]).map((v) => <option key={v} value={v}>{t(`blackboard.courseStatus.${v}`)}</option>)}</select></div>
        <p className="mt-3 text-xs text-muted-foreground">{t("blackboard.collection.showing", { count: courses.length, total: data.courses.length })}</p>
        {terms.filter((v) => courses.some((c) => (c.term || c.term_id) === v)).map((v) => <section key={v} className="mt-4"><h4 className="mb-2 text-sm font-semibold" dir="auto">{v || t("blackboard.collection.unknownTerm")}</h4>
          {courses.filter((c) => (c.term || c.term_id) === v).map((c) => <details key={c.id} className="mb-2 rounded-2xl border border-border bg-background p-3">
            <summary className="cursor-pointer"><span className="font-medium" dir="auto">{c.title}</span><span className="ms-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">{t(`blackboard.courseStatus.${c.status}`)}</span><p className="mt-1 text-xs text-muted-foreground" dir="auto">{c.code} · {t("blackboard.collection.courseCounts", { items: c.items.length, files: c.files.length, grades: c.grades.length })}</p></summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">{t("blackboard.collection.term")}: <bdi>{c.term || t("blackboard.collection.unknownTerm")}</bdi> · <bdi>{c.term_id || c.external_id}</bdi></p>
              {c.instructors.map((i, n) => <p key={n} className="text-sm" dir="auto">{i.name}</p>)}
              <details className="text-xs"><summary className="cursor-pointer">{t("blackboard.collection.metadata")}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-3" dir="ltr">{JSON.stringify({ ...c.metadata, grade_summary: c.grade_summary, source: c.source_kind }, null, 2)}</pre></details>
              {c.items.map((i) => <details key={i.id} className="rounded-xl bg-muted/40 p-3"><summary className="cursor-pointer text-sm" dir="auto">{blackboardFileTitle(i.title, i.filename) || i.title}<span className="ms-2 text-xs text-muted-foreground">{i.type}</span></summary><p className="mt-2 whitespace-pre-wrap break-words text-sm" dir="auto">{i.text || t("blackboard.collection.noText")}</p>{i.due_at && <p className="mt-2 text-xs">{t("blackboard.collection.due")}: {fmt.dateTime(i.due_at)}</p>}</details>)}
              {c.grades.length > 0 && <div className="overflow-x-auto"><table className="w-full text-start text-xs"><thead><tr><th className="p-2 text-start">{t("blackboard.collection.grades")}</th><th className="p-2 text-start">{t("blackboard.collection.score")}</th><th className="p-2 text-start">{t("blackboard.collection.feedback")}</th></tr></thead><tbody>{c.grades.map((g) => <tr key={g.id} className="border-t"><td className="p-2" dir="auto">{g.title}</td><td className="p-2 tabular-nums">{g.score ?? "—"} / {g.possible ?? "—"}<br />{g.status}</td><td className="p-2" dir="auto">{g.feedback}</td></tr>)}</tbody></table></div>}
              {c.files.length > 0 && <BlackboardFiles files={c.files} />}
            </div>
          </details>)}
        </section>)}
      </>}
      {tab === "files" && <div className="mt-4"><BlackboardFiles files={files} /></div>}
      {(tab === "events" || tab === "diagnostics") && <pre className="mt-4 max-h-[600px] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-3 text-xs" dir="ltr">{JSON.stringify(tab === "events" ? data.events : data.diagnostics, null, 2)}</pre>}
      {tab === "records" && <pre className="mt-4 max-h-[600px] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-3 text-xs" dir="ltr">{JSON.stringify(data.snapshot, null, 2)}</pre>}
    </>}
  </div>
}
