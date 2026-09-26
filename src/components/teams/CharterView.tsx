"use client"

import { Avatar } from "@/components/teams/ui"
import { memberName, type TeamStore } from "@/lib/team-store"

export function CharterView({ store }: { store: TeamStore }) {
  const { charter, assignment } = store.team
  const brief = assignment.brief as { problem?: string; objective?: string; deliverables?: string[]; constraints?: string[] }
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="tm-h2">Charter</h2>
        {charter.goal ? (
          <div className="tm-card flex flex-col gap-1">
            <p className="m-0 font-semibold" dir="auto">{charter.goal}</p>
            {charter.meetings ? <small>Meetings: {charter.meetings}</small> : null}
          </div>
        ) : <p className="tm-muted">No charter yet.</p>}
        {charter.roles ? (
          <div className="tm-list mt-3">
            {Object.entries(charter.roles).map(([userId, role]) => (
              <div key={userId} className="tm-member">
                <Avatar userId={userId} name={memberName(store, userId)} size={24} />
                <span>{memberName(store, userId)}</span>
                <small className="ml-auto">{role}</small>
              </div>
            ))}
          </div>
        ) : null}
        {charter.working_agreement?.length ? (
          <ul className="mt-3 list-disc pl-5 text-sm">{charter.working_agreement.map((item) => <li key={item} dir="auto">{item}</li>)}</ul>
        ) : null}
      </section>
      <section>
        <h2 className="tm-h2">Assignment brief</h2>
        <div className="tm-card flex flex-col gap-2">
          <strong>{assignment.title}</strong>
          {brief.problem ? <p className="m-0">{brief.problem}</p> : null}
          {brief.objective ? <p className="m-0 text-[var(--fq-muted)]">{brief.objective}</p> : null}
          {brief.deliverables?.length ? <ul className="m-0 list-disc pl-5 text-sm">{brief.deliverables.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          {brief.constraints?.length ? <small>Constraints: {brief.constraints.join(" · ")}</small> : null}
        </div>
      </section>
      {assignment.rubric.length > 0 ? (
        <section>
          <h2 className="tm-h2">Rubric</h2>
          <div className="tm-list">
            {assignment.rubric.map((criterion) => (
              <div key={criterion.id} className="tm-card flex items-start justify-between gap-3">
                <div>
                  <strong>{criterion.title}</strong>
                  <small className="block">{criterion.description}</small>
                </div>
                <span className="tm-chip">{criterion.weight}%</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
