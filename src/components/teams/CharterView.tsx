"use client"

import { useState } from "react"
import { FileUp } from "lucide-react"
import { ProjectDetailsEditor } from "./ProjectDetailsEditor"
import { ProjectSetup } from "@/components/teams/ProjectSetup"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { type TeamStore } from "@/lib/team-store"
import { useI18n } from "@/lib/i18n/context"
import { useTeamClient } from "./team-client-context"

interface CharterViewProps { store: TeamStore; canEdit: boolean; update: StoreUpdate }

export function CharterView({ store, canEdit, update }: CharterViewProps) {
  const { t, fmt } = useI18n()
  const teams = useTeamClient()
  const lead = store.team.viewer_role === "lead"
  const [editing, setEditing] = useState<"project" | "assignment" | null>(null)
  const { assignment, project } = store.team
  const brief = assignment.brief as { problem?: string; objective?: string; deliverables?: string[]; constraints?: string[] }
  const own = project?.brief ?? {}
  const hasOwnBrief = Boolean(own.problem || own.objective || own.scope)
  // The team's imported rubric replaces the assignment's; otherwise the shared one applies.
  const rubric = project?.rubric.length
    ? project.rubric.map((item) => ({ key: item.name, title: item.name, description: item.description, weight: item.weight }))
    : assignment.rubric.map((item) => ({ key: item.id, title: item.title, description: item.description, weight: item.weight }))
  return (
    <div className="gp-setup">
      {canEdit && teams.projectImport ? <details className="gp-import-disclosure" open={Object.values(store.imports).some(item => ["reading", "review", "failed"].includes(item.status))}>
        <summary><FileUp className="size-4" aria-hidden="true" /><span>{t("teams.ui.importDescription")}</span><small>{t("teams.ui.importHint")}</small></summary>
        <div className="gp-import-content"><ProjectSetup store={store} update={update} /></div>
      </details> : null}
      {lead || hasOwnBrief || project?.deliverables.length ? (
        <section className="gp-brief">
          <div className="flex items-center justify-between gap-3"><h2 className="tm-h2">{t("teams.charter.project")}</h2>{lead && editing !== "project" ? <button className="tm-btn tm-btn-sm" onClick={() => setEditing("project")}>{t("teams.common.edit")}</button> : null}</div>
          {lead && editing === "project" ? <ProjectDetailsEditor kind="project" store={store} update={update} onClose={() => setEditing(null)} /> : (
          <div className="tm-card flex flex-col gap-2">
            {!hasOwnBrief && !project.deliverables.length ? <p className="tm-muted m-0">{t("teams.ui.emptyBrief")}</p> : null}
            {own.problem ? <p className="m-0" dir="auto">{own.problem}</p> : null}
            {own.objective ? <p className="m-0 text-[var(--fq-muted)]" dir="auto">{own.objective}</p> : null}
            {own.scope ? <p className="m-0 text-[var(--fq-muted)]" dir="auto">{own.scope}</p> : null}
            {own.constraints?.length ? <small>{t("teams.charter.constraints", { value: own.constraints.join(" · ") })}</small> : null}
            {own.tools?.length ? <small>{t("teams.charter.tools", { value: own.tools.join(" · ") })}</small> : null}
            {project.deliverables.length ? (
              <>
                <strong className="mt-2 text-sm">{t("teams.charter.deliverables")}</strong>
                <ul className="m-0 flex flex-col gap-1 p-0 text-sm">
                  {project.deliverables.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-center gap-2">
                      <span dir="auto">{item.title}</span>
                      {item.doc_kind ? <span className="tm-chip">{item.doc_kind.toUpperCase()}</span> : null}
                      {item.due ? <span className="tm-chip ms-auto">{t("teams.charter.due", { date: fmt.date(item.due) })}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>)}
        </section>
      ) : null}
      <section className="gp-brief">
        <div className="flex items-center justify-between gap-3"><h2 className="tm-h2">{t("teams.charter.brief")}</h2>{lead && editing !== "assignment" ? <button className="tm-btn tm-btn-sm" onClick={() => setEditing("assignment")}>{t("teams.common.edit")}</button> : null}</div>
        {lead && editing === "assignment" ? <ProjectDetailsEditor kind="assignment" store={store} update={update} onClose={() => setEditing(null)} /> : (
        <div className="tm-card flex flex-col gap-2">
          {assignment.title ? <strong dir="auto">{assignment.title}</strong> : null}
          {!assignment.title && !brief.problem && !brief.objective && !brief.deliverables?.length ? <p className="tm-muted m-0">{t("teams.ui.emptyAssignment")}</p> : null}
          {brief.problem ? <p className="m-0" dir="auto">{brief.problem}</p> : null}
          {brief.objective ? <p className="m-0 text-[var(--fq-muted)]" dir="auto">{brief.objective}</p> : null}
          {brief.deliverables?.length ? <ul className="m-0 list-disc ps-5 text-sm">{brief.deliverables.map((item) => <li key={item} dir="auto">{item}</li>)}</ul> : null}
          {brief.constraints?.length ? <small>{t("teams.charter.constraints", { value: brief.constraints.join(" · ") })}</small> : null}
        </div>)}
      </section>
      {rubric.length > 0 ? (
        <section className="gp-rubric">
          <h2 className="tm-h2">{t("teams.charter.rubric")}</h2>
          <div className="tm-list">
            {rubric.map((criterion) => (
              <div key={criterion.key} className="gp-rubric-row">
                <div>
                  <strong dir="auto">{criterion.title}</strong>
                  <small className="block" dir="auto">{criterion.description}</small>
                </div>
                <span className="tm-chip">{fmt.percent(criterion.weight / 100)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
