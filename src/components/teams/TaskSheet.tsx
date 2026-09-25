"use client"

import { useState } from "react"
import { Sparkles, Trash2 } from "lucide-react"
import { Sheet } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { fromDateInput, toDateInput } from "@/lib/team-format"
import { TASK_COLUMNS, removeTask, upsertTask, type TeamStore } from "@/lib/team-store"
import { teams, type TaskStatus, type TeamTask } from "@/lib/teams-api"

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
  const others = Object.values(store.tasks).filter((task) => task.id !== existing?.id)
  const milestones = Object.values(store.milestones)

  const save = async () => {
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
      onError(reason)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setSaving(true)
    try {
      await teams.deleteTask(existing.id)
      update((current) => removeTask(current, existing.id))
      onClose()
    } catch (reason) {
      onError(reason)
    } finally {
      setSaving(false)
    }
  }

  const footer = canEdit ? (
    <>
      {existing ? (
        <button type="button" className="tm-btn" disabled={saving} onClick={() => void remove()}>
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </button>
      ) : <span />}
      <button type="button" className="tm-btn tm-btn-primary" disabled={saving || !title.trim()} onClick={() => void save()}>
        {existing ? "Save" : "Create task"}
      </button>
    </>
  ) : undefined

  return (
    <Sheet title={existing ? "Task" : "New task"} onClose={onClose} footer={footer}>
      <label className="tm-field">Title
        <input className="tm-input" dir="auto" value={title} maxLength={200} disabled={!canEdit} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="tm-field">Description
        <textarea className="tm-textarea" dir="auto" value={description} disabled={!canEdit} onChange={(event) => setDescription(event.target.value)} />
      </label>
      {existing?.rationale ? (
        <p className="tm-rationale"><Sparkles className="mr-1 inline size-3.5" aria-hidden="true" />{existing.rationale}</p>
      ) : null}
      <div className="tm-grid2">
        <label className="tm-field">Status
          <select className="tm-select" value={status} disabled={!canEdit} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
            {TASK_COLUMNS.map((column) => <option key={column.status} value={column.status}>{column.label}</option>)}
          </select>
        </label>
        <label className="tm-field">Assignee
          <select className="tm-select" value={assignee} disabled={!canEdit} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Unassigned</option>
            {store.team.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
          </select>
        </label>
        <label className="tm-field">Points
          <select className="tm-select" value={points} disabled={!canEdit} onChange={(event) => setPoints(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="tm-field">Due
          <input type="date" className="tm-input" value={due} disabled={!canEdit} onChange={(event) => setDue(event.target.value)} />
        </label>
      </div>
      <label className="tm-field">Milestone
        <select className="tm-select" value={milestone} disabled={!canEdit} onChange={(event) => setMilestone(event.target.value)}>
          <option value="">None</option>
          {milestones.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      {others.length > 0 ? (
        <fieldset className="tm-field">
          <legend>Depends on</legend>
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
