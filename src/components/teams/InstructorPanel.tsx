"use client"

import { Fragment, useEffect, useState } from "react"
import { Avatar } from "@/components/teams/ui"
import { timeAgo } from "@/lib/team-format"
import type { TeamStore } from "@/lib/team-store"
import { errorMessage, teams, type ContributionRow } from "@/lib/teams-api"

export function InstructorPanel({ store }: { store: TeamStore }) {
  const [rows, setRows] = useState<ContributionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const teamId = store.team.id
  const seq = store.lastSeq

  useEffect(() => {
    let cancelled = false
    teams.contribution(teamId)
      .then((result) => { if (!cancelled) setRows(result.members) })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [teamId, seq])

  const maxPoints = Math.max(1, ...(rows ?? []).map((row) => row.done_points + row.open_points))
  const milestones = Object.values(store.milestones)
  const completed = milestones.filter((milestone) => milestone.completed_at).length
  const decisions = Object.values(store.decisions).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3)

  return (
    <aside className="tm-panel tm-dock" aria-label="Instructor view">
      <header className="tm-chat-head">
        <div>
          <strong>Instructor view</strong>
          <small className="block text-[11px] text-[var(--fq-muted)]">The team chat is private to students</small>
        </div>
      </header>
      <div className="flex flex-col gap-5 overflow-auto p-4">
        <section>
          <h2 className="tm-h2">Contribution</h2>
          {error ? <p className="tm-banner">{error}</p> : null}
          {!error && rows === null ? <p className="tm-muted">Loading…</p> : null}
          {rows ? (
            <div className="tm-contrib">
              {rows.map((row) => (
                <Fragment key={row.user_id}>
                  <Avatar userId={row.user_id} name={row.display_name} size={24} />
                  <div className="min-w-0">
                    <span className="block truncate">{row.display_name}</span>
                    <div className="tm-bar" style={{ width: "100%" }}><i style={{ width: `${(100 * row.done_points) / maxPoints}%` }} /></div>
                  </div>
                  <small>{row.done_points}/{row.done_points + row.open_points} pts</small>
                </Fragment>
              ))}
            </div>
          ) : null}
        </section>
        <section>
          <h2 className="tm-h2">Milestones</h2>
          <p className="m-0 text-sm">{completed} of {milestones.length} complete</p>
        </section>
        <section>
          <h2 className="tm-h2">Latest decisions</h2>
          {decisions.length === 0 ? <p className="tm-muted">None yet.</p> : (
            <div className="tm-list">
              {decisions.map((decision) => (
                <div key={decision.id} className="tm-card">
                  <p className="m-0" dir="auto">{decision.text}</p>
                  <small>{timeAgo(decision.created_at)}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
