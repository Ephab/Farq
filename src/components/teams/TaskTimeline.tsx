"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Sheet } from "./ui"
import { errorMessage } from "@/lib/teams-api"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { dueLabel, fromDateInput, shortDate } from "@/lib/team-format"
import { upsertMilestone, type TeamStore } from "@/lib/team-store"
import { useTeamClient } from "@/components/teams/team-client-context"
import { useI18n } from "@/lib/i18n/context"

interface TaskTimelineProps { store: TeamStore; canEdit: boolean; update: StoreUpdate; onError: (reason: unknown) => void }

export function TaskTimeline({ store, canEdit, update, onError }: TaskTimelineProps) {
  const teams = useTeamClient()
  const { t, locale } = useI18n()
  const [title, setTitle] = useState("")
  const [due, setDue] = useState("")
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tasks = Object.values(store.tasks)
  const milestones = Object.values(store.milestones).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
  const deadline = store.team.assignment.deadline
  const dated = tasks
    .filter((task) => !task.milestone_id && task.due && task.status !== "done")
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))

  const add = async () => {
    setBusy(true); setError(null)
    try {
      const created = await teams.createMilestone(store.team.id, { title: title.trim(), due: fromDateInput(due) })
      update((current) => upsertMilestone(current, created))
      setTitle("")
      setDue("")
      setAdding(false)
    } catch (reason) {
      onError(reason)
      setError(errorMessage(reason))
    } finally { setBusy(false) }
  }

  return (
    <div className="gp-timeline-view">
      <div className="tm-board-head"><h2 className="tm-h2" style={{ marginBottom: 0 }}>{t("teams.timeline.title")}</h2>
        {canEdit ? <button type="button" className="tm-btn tm-btn-primary" onClick={() => { setError(null); setAdding(true) }}><Plus className="size-4" aria-hidden="true" />{t("teams.timeline.addMilestone")}</button> : null}
      </div>
      {!milestones.length && !deadline ? <p className="tm-muted">{t("teams.ui.noMilestones")}</p> : null}
      <ol className="tm-timeline">
        {milestones.map((milestone) => {
          const own = tasks.filter((task) => task.milestone_id === milestone.id)
          const done = own.filter((task) => task.status === "done").length
          const pct = own.length ? Math.round((100 * done) / own.length) : 0
          return (
            <li key={milestone.id} className="tm-ms" data-done={milestone.completed_at ? "" : undefined}>
              <strong dir="auto">{milestone.title}</strong>
              <span>
                {milestone.due ? shortDate(milestone.due, locale) : t("teams.timeline.noDate")}
                {milestone.completed_at ? ` · ${t("teams.timeline.complete")}` : milestone.due ? ` · ${dueLabel(milestone.due, t)}` : ""}
              </span>
              <div className="tm-bar" data-done={milestone.completed_at ? "" : undefined}><i style={{ width: `${pct}%` }} /></div>
              <span>{t("teams.timeline.tasksDone", { done, total: own.length })}</span>
            </li>
          )
        })}
        {deadline ? (
          <li className="tm-ms" data-final="">
            <strong>{t("teams.timeline.finalDeadline")}</strong>
            <span>{shortDate(deadline, locale)} · {dueLabel(deadline, t)}</span>
          </li>
        ) : null}
      </ol>
      {dated.length > 0 ? (
        <section>
          <h2 className="tm-h2">{t("teams.timeline.datedTasks")}</h2>
          <div className="tm-list">
            {dated.map((task) => (
              <div key={task.id} className="gp-dated-task">
                <span dir="auto">{task.title}</span>
                <small>{task.due ? shortDate(task.due, locale) : ""}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {canEdit && adding ? <Sheet title={t("teams.timeline.newMilestone")} onClose={() => setAdding(false)}>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void add() }}>
          <label className="tm-field">{t("teams.timeline.newMilestone")}
            <input className="tm-input" dir="auto" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="tm-field">{t("teams.timeline.due")}
            <input type="date" className="tm-input" value={due} onChange={(event) => setDue(event.target.value)} />
          </label>
          {error ? <p className="tm-banner" role="alert">{error}</p> : null}
          <button type="submit" className="tm-btn tm-btn-primary" disabled={busy || !title.trim()}>{t("teams.timeline.addMilestone")}</button>
        </form>
      </Sheet> : null}
    </div>
  )
}
