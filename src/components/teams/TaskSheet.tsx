"use client"

import { useState } from "react"
import { Sparkles, Trash2 } from "lucide-react"
import { Banner, Sheet } from "@/components/teams/ui"
import { errorMessage } from "@/lib/teams-api"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { fromDateInput, toDateInput } from "@/lib/team-format"
import { TASK_COLUMNS, removeTask, upsertMessage, upsertTask, type TeamStore } from "@/lib/team-store"
import type { TaskStatus, TeamTask } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"
import { useI18n } from "@/lib/i18n/context"

export type TaskSheetState = { mode: "create"; title?: string } | { mode: "edit"; task: TeamTask }

interface TaskSheetProps {
  state: TaskSheetState
  store: TeamStore
  canEdit: boolean
  update: StoreUpdate
  onError: (reason: unknown) => void
  onClose: () => void
}

export function TaskSheet({ state, store, canEdit, update, onError, onClose }: TaskSheetProps) {
  const teams = useTeamClient()
  const { t } = useI18n()
  const existing = state.mode === "edit" ? store.tasks[state.task.id] ?? state.task : null
  const [title, setTitle] = useState(existing?.title ?? (state.mode === "create" ? state.title ?? "" : ""))
  const [description, setDescription] = useState(existing?.description ?? "")
  const [assignee, setAssignee] = useState(existing?.assignee_id ?? "")
  const [points, setPoints] = useState(existing?.estimate_points ?? 1)
  const [due, setDue] = useState(toDateInput(existing?.due ?? null))
  const [milestone, setMilestone] = useState(existing?.milestone_id ?? "")
  const [deps, setDeps] = useState<string[]>(existing?.depends_on ?? [])
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? "todo")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = Object.values(store.tasks).filter((task) => task.id !== existing?.id)
  const milestones = Object.values(store.milestones)

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const body = {
        title: title.trim(), description, assignee_id: assignee || null, estimate_points: points,
        due: fromDateInput(due), milestone_id: milestone || null, depends_on: deps,
      }
      let task = existing ? await teams.updateTask(existing.id, body) : await teams.createTask(store.team.id, body)
      if (status !== task.status) task = await teams.moveTask(task.id, status)
      const saved = task
      update((current) => upsertTask(current, saved))
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
      onError(reason)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setSaving(true)
    setError(null)
    try {
      await teams.deleteTask(existing.id)
      update((current) => removeTask(current, existing.id))
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
      onError(reason)
    } finally {
      setSaving(false)
    }
  }

  const breakDown = async () => {
    if (!existing) return
    setSaving(true)
    setError(null)
    try {
      const message = await teams.postMessage(store.team.id, { content: `@Hermes break down "${existing.title}" into smaller tasks for our team` })
      update((current) => upsertMessage(current, message))
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
      onError(reason)
    } finally {
      setSaving(false)
    }
  }

  const footer = canEdit ? (
    <>
      {existing ? (
        <div className="flex gap-2">
          <button type="button" className="tm-btn" disabled={saving} onClick={() => void remove()}>
            <Trash2 className="size-4" aria-hidden="true" /> {t("teams.common.delete")}
          </button>
          {teams.teamAI && existing.status === "todo" ? (
            <button type="button" className="tm-btn" disabled={saving} onClick={() => void breakDown()}>
              <Sparkles className="size-4" aria-hidden="true" /> {t("teams.sheet.breakDown")}
            </button>
          ) : null}
        </div>
      ) : <span />}
      <button type="button" className="tm-btn tm-btn-primary" disabled={saving || !title.trim()} onClick={() => void save()}>
        {existing ? t("teams.common.save") : t("teams.sheet.createTask")}
      </button>
    </>
  ) : undefined

  return (
    <Sheet title={existing ? t("teams.sheet.task") : t("teams.sheet.newTask")} onClose={onClose} footer={footer}>
      {error ? <Banner message={error} onDismiss={() => setError(null)} /> : null}
      <label className="tm-field">{t("teams.sheet.title")}
        <input className="tm-input" dir="auto" value={title} maxLength={200} disabled={!canEdit} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="tm-field">{t("teams.sheet.description")}
        <textarea className="tm-textarea" dir="auto" value={description} disabled={!canEdit} onChange={(event) => setDescription(event.target.value)} />
      </label>
      {existing?.rationale ? (
        <p className="tm-rationale"><Sparkles className="me-1 inline size-3.5" aria-hidden="true" /><bdi>{existing.rationale}</bdi></p>
      ) : null}
      <div className="tm-grid2">
        <label className="tm-field">{t("teams.sheet.status")}
          <select className="tm-select" value={status} disabled={!canEdit} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
            {TASK_COLUMNS.map((column) => <option key={column.status} value={column.status}>{t(`teams.status.${column.status}`)}</option>)}
          </select>
        </label>
        <label className="tm-field">{t("teams.sheet.assignee")}
          <select className="tm-select" value={assignee} disabled={!canEdit} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">{t("teams.sheet.unassigned")}</option>
            {store.team.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
          </select>
        </label>
        <label className="tm-field">{t("teams.sheet.points")}
          <select className="tm-select" value={points} disabled={!canEdit} onChange={(event) => setPoints(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="tm-field">{t("teams.sheet.due")}
          <input type="date" className="tm-input" value={due} disabled={!canEdit} onChange={(event) => setDue(event.target.value)} />
        </label>
      </div>
      <label className="tm-field">{t("teams.sheet.milestone")}
        <select className="tm-select" value={milestone} disabled={!canEdit} onChange={(event) => setMilestone(event.target.value)}>
          <option value="">{t("teams.sheet.none")}</option>
          {milestones.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      {others.length > 0 ? (
        <fieldset className="tm-field">
          <legend>{t("teams.sheet.dependsOn")}</legend>
          <div className="tm-checks">
            {others.map((task) => (
              <label key={task.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={deps.includes(task.id)}
                  disabled={!canEdit}
                  onChange={(event) => setDeps((current) => (event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id)))}
                />
                <span dir="auto">{task.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </Sheet>
  )
}
