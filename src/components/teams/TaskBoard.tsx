"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { CalendarDays, Link2, Plus, Sparkles } from "lucide-react"
import { Avatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { EASE_OUT } from "@/lib/ease"
import { dueLabel } from "@/lib/team-format"
import { TASK_COLUMNS, isBlocked, memberName, moveTaskLocal, tasksByStatus, type TeamStore } from "@/lib/team-store"
import { teams, type TaskStatus, type TeamTask } from "@/lib/teams-api"

interface TaskBoardProps {
  store: TeamStore
  canEdit: boolean
  update: StoreUpdate
  onError: (reason: unknown) => void
  onOpenTask: (task: TeamTask) => void
  onNewTask: () => void
}

export function TaskBoard({ store, canEdit, update, onError, onOpenTask, onNewTask }: TaskBoardProps) {
  const columns = tasksByStatus(store)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const reduceMotion = useReducedMotion()

  const drop = (status: TaskStatus) => {
    const task = dragging ? store.tasks[dragging] : undefined
    setDragging(null)
    setOver(null)
    if (!task || task.status === status) return
    const position = columns[status].reduce((max, item) => Math.max(max, item.position), 0) + 1
    update((current) => moveTaskLocal(current, task.id, status, position))
    teams.moveTask(task.id, status, position).catch(onError)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="tm-board-head">
        <h2 className="tm-h2" style={{ marginBottom: 0 }}>Board</h2>
        {canEdit ? (
          <button type="button" className="tm-btn tm-btn-primary" onClick={onNewTask}>
            <Plus className="size-4" aria-hidden="true" /> New task
          </button>
        ) : null}
      </div>
      <div className="tm-columns">
        {TASK_COLUMNS.map((column) => (
          <section
            key={column.status}
            className="tm-col"
            aria-label={column.label}
            data-over={over === column.status ? "" : undefined}
            onDragOver={canEdit ? (event) => { event.preventDefault(); setOver(column.status) } : undefined}
            onDragLeave={() => setOver((current) => (current === column.status ? null : current))}
            onDrop={canEdit ? (event) => { event.preventDefault(); drop(column.status) } : undefined}
          >
            <header><span>{column.label}</span><span className="tm-count">{columns[column.status].length}</span></header>
            {columns[column.status].map((task) => (
              <motion.div key={task.id} layout={!reduceMotion} transition={{ duration: 0.28, ease: EASE_OUT }}>
                <div
                  className="tm-task"
                  role="button"
                  tabIndex={0}
                  draggable={canEdit}
                  data-dragging={dragging === task.id ? "" : undefined}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", task.id)
                    setDragging(task.id)
                  }}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  onClick={() => onOpenTask(task)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task) }
                  }}
                >
                  <TaskCardBody store={store} task={task} />
                </div>
              </motion.div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function TaskCardBody({ store, task }: { store: TeamStore; task: TeamTask }) {
  const due = task.status === "done" ? null : dueLabel(task.due)
  const blocked = task.status !== "done" && isBlocked(store, task)
  return (
    <>
      <span className="tm-task-title" dir="auto">{task.title}</span>
      <span className="tm-task-meta">
        <span className="tm-chip">{task.estimate_points} pt</span>
        {blocked ? <span className="tm-chip tm-chip-warn"><Link2 className="size-3" aria-hidden="true" /> Blocked</span> : null}
        {due ? <span className="tm-chip"><CalendarDays className="size-3" aria-hidden="true" /> {due}</span> : null}
        {task.created_by === "hermes" ? <span className="tm-chip tm-chip-accent"><Sparkles className="size-3" aria-hidden="true" /> Hermes</span> : null}
        {task.assignee_id ? (
          <span className="ml-auto"><Avatar userId={task.assignee_id} name={memberName(store, task.assignee_id)} size={22} /></span>
        ) : null}
      </span>
    </>
  )
}
