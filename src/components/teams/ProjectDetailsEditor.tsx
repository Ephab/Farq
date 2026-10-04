import { useState } from "react"
import { useTeamClient } from "./team-client-context"
import { useI18n } from "@/lib/i18n/context"
import { errorMessage, type ProjectBrief } from "@/lib/teams-api"
import type { TeamStore } from "@/lib/team-store"
import type { StoreUpdate } from "./use-team-stream"
import { fromDateInput, toDateInput } from "@/lib/team-format"

const lines = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean)

export function ProjectDetailsEditor({ kind, store, update, onClose }: {
  kind: "project" | "assignment"; store: TeamStore; update: StoreUpdate; onClose: () => void
}) {
  const teams = useTeamClient()
  const { t } = useI18n()
  const initial = (kind === "project" ? store.team.project.brief : store.team.assignment.brief) as ProjectBrief
  const [brief, setBrief] = useState(initial)
  const [title, setTitle] = useState(store.team.assignment.title)
  const [constraints, setConstraints] = useState((initial.constraints ?? []).join("\n"))
  const [tools, setTools] = useState((initial.tools ?? []).join("\n"))
  const [assignmentDeliverables, setAssignmentDeliverables] = useState(((store.team.assignment.brief.deliverables ?? []) as string[]).join("\n"))
  const [deliverables, setDeliverables] = useState(store.team.project.deliverables)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const team = await teams.editProjectDetails(store.team.id, kind === "project"
        ? { project: { brief: { ...brief, constraints: lines(constraints), tools: lines(tools) }, deliverables } }
        : { assignment: { title: title.trim(), problem: brief.problem ?? "", objective: brief.objective ?? "", constraints: lines(constraints), deliverables: lines(assignmentDeliverables) } })
      update(current => ({ ...current, team: { ...current.team, project: team.project, assignment: team.assignment } }))
      onClose()
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  return <form className="tm-card flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save() }}>
    {kind === "assignment" ? <label className="tm-field">{t("teams.charter.editTitle")}<input className="tm-input" dir="auto" required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label> : null}
    {(["problem", "objective", ...(kind === "project" ? ["scope"] as const : [])] as const).map(field => <label className="tm-field" key={field}>
      {t(`teams.charter.edit${field === "problem" ? "Problem" : field === "objective" ? "Objective" : "Scope"}`)}
      <textarea className="tm-input min-h-24" dir="auto" maxLength={3000} value={brief[field] ?? ""} onChange={event => setBrief(value => ({ ...value, [field]: event.target.value }))} />
    </label>)}
    <label className="tm-field">{t("teams.charter.editConstraints")}<textarea className="tm-input" dir="auto" value={constraints} onChange={event => setConstraints(event.target.value)} /></label>
    {kind === "project" ? <>
      <label className="tm-field">{t("teams.charter.editTools")}<textarea className="tm-input" dir="auto" value={tools} onChange={event => setTools(event.target.value)} /></label>
      <strong>{t("teams.charter.deliverables")}</strong>
      {deliverables.map((item, index) => <div key={index} className="tm-card flex flex-col gap-2">
        <label className="tm-field">{t("teams.charter.editTitle")}<input className="tm-input" dir="auto" required maxLength={200} value={item.title} onChange={event => setDeliverables(values => values.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} /></label>
        <label className="tm-field">{t("teams.charter.editDue")}<input className="tm-input" type="date" value={toDateInput(item.due)} onChange={event => setDeliverables(values => values.map((value, i) => i === index ? { ...value, due: fromDateInput(event.target.value) } : value))} /></label>
        <label className="tm-field">{t("teams.charter.editDocKind")}<select className="tm-select" value={item.doc_kind ?? ""} onChange={event => setDeliverables(values => values.map((value, i) => i === index ? { ...value, doc_kind: (event.target.value || null) as typeof item.doc_kind } : value))}>
          <option value="">{t("teams.charter.editNoDoc")}</option>{["srs", "sds", "spmp"].map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select></label>
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => setDeliverables(values => values.filter((_, i) => i !== index))}>{t("teams.charter.removeDeliverable")}</button>
      </div>)}
      <button type="button" className="tm-btn tm-btn-sm" disabled={deliverables.length >= 20} onClick={() => setDeliverables(values => [...values, { key: `d-${crypto.randomUUID().slice(0, 12)}`, title: "", due: null, doc_kind: null }])}>{t("teams.charter.addDeliverable")}</button>
    </> : <label className="tm-field">{t("teams.charter.editDeliverables")}<textarea className="tm-input" dir="auto" value={assignmentDeliverables} onChange={event => setAssignmentDeliverables(event.target.value)} /></label>}
    {error ? <p role="alert" className="tm-banner">{error}</p> : null}
    <div className="flex justify-end gap-2">
      <button type="button" className="tm-btn" disabled={busy} onClick={onClose}>{t("teams.common.cancel")}</button>
      <button className="tm-btn tm-btn-primary" disabled={busy || (kind === "project" && ![brief.problem, brief.objective, brief.scope].some(value => value?.trim()))}>{t("teams.common.save")}</button>
    </div>
  </form>
}
