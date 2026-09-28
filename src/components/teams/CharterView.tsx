"use client"

import { ProjectSetup } from "@/components/teams/ProjectSetup"
import { Avatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { memberName, type TeamStore } from "@/lib/team-store"
import { useI18n } from "@/lib/i18n/context"

interface CharterViewProps { store: TeamStore; canEdit: boolean; update: StoreUpdate }

export function CharterView({ store, canEdit, update }: CharterViewProps) {
  const { t, fmt } = useI18n()
  const { charter, assignment, project } = store.team
  const brief = assignment.brief as { problem?: string; objective?: string; deliverables?: string[]; constraints?: string[] }
  const own = project?.brief ?? {}
  const hasOwnBrief = Boolean(own.problem || own.objective || own.scope)
  // The team's imported rubric replaces the assignment's; otherwise the shared one applies.
  const rubric = project?.rubric.length
    ? project.rubric.map((item) => ({ key: item.name, title: item.name, description: item.description, weight: item.weight }))
    : assignment.rubric.map((item) => ({ key: item.id, title: item.title, description: item.description, weight: item.weight }))
  return (
    <div className="flex flex-col gap-6">
      {canEdit ? <ProjectSetup store={store} update={update} /> : null}
      <section>
        <h2 className="tm-h2">{t("teams.charter.title")}</h2>
        {charter.goal ? (
          <div className="tm-card flex flex-col gap-1">
            <p className="m-0 font-semibold" dir="auto">{charter.goal}</p>
            {charter.meetings ? <small>{t("teams.charter.meetings", { value: charter.meetings })}</small> : null}
          </div>
        ) : <p className="tm-muted">{t("teams.charter.none")}</p>}
        {charter.roles ? (
          <div className="tm-list mt-3">
            {Object.entries(charter.roles).map(([userId, role]) => (
              <div key={userId} className="tm-member">
                <Avatar userId={userId} name={memberName(store, userId)} size={24} />
                <span dir="auto">{memberName(store, userId)}</span>
                <small className="ms-auto" dir="auto">{role}</small>
              </div>
            ))}
          </div>
        ) : null}
        {charter.working_agreement?.length ? (
          <ul className="mt-3 list-disc ps-5 text-sm">{charter.working_agreement.map((item) => <li key={item} dir="auto">{item}</li>)}</ul>
        ) : null}
      </section>
      {hasOwnBrief || project?.deliverables.length ? (
        <section>
          <h2 className="tm-h2">{t("teams.charter.project")}</h2>
          <div className="tm-card flex flex-col gap-2">
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
          </div>
        </section>
      ) : null}
      <section>
        <h2 className="tm-h2">{t("teams.charter.brief")}</h2>
        <div className="tm-card flex flex-col gap-2">
          <strong dir="auto">{assignment.title}</strong>
          {brief.problem ? <p className="m-0" dir="auto">{brief.problem}</p> : null}
          {brief.objective ? <p className="m-0 text-[var(--fq-muted)]" dir="auto">{brief.objective}</p> : null}
          {brief.deliverables?.length ? <ul className="m-0 list-disc ps-5 text-sm">{brief.deliverables.map((item) => <li key={item} dir="auto">{item}</li>)}</ul> : null}
          {brief.constraints?.length ? <small>{t("teams.charter.constraints", { value: brief.constraints.join(" · ") })}</small> : null}
        </div>
      </section>
      {rubric.length > 0 ? (
        <section>
          <h2 className="tm-h2">{t("teams.charter.rubric")}</h2>
          <div className="tm-list">
            {rubric.map((criterion) => (
              <div key={criterion.key} className="tm-card flex items-start justify-between gap-3">
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
