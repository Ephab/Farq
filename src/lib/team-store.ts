import type {
  DocSectionInfo, PresenceEntry, TaskStatus, TeamDecision, TeamDocumentInfo, TeamEvent, TeamInfo, TeamMessage, TeamMilestone, TeamState, TeamTask,
} from "@/lib/teams-api"

/** Every event type the stream can send; EventSource needs a listener per named event. */
export const TEAM_EVENT_TYPES = [
  "task.created", "task.updated", "task.moved", "task.deleted",
  "milestone.created", "milestone.updated", "milestone.completed",
  "decision.pinned", "decision.removed",
  "message.created", "message.edited", "message.deleted", "reaction.toggled",
  "document.created", "section.updated", "section.locked", "section.unlocked",
  "member.joined", "invite.created", "invite.declined", "invite.cancelled",
] as const

export const TASK_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "Doing" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
]

export interface TeamStore {
  team: TeamInfo
  tasks: Record<string, TeamTask>
  milestones: Record<string, TeamMilestone>
  decisions: Record<string, TeamDecision>
  documents: Record<string, TeamDocumentInfo>
  /** null for instructors: the team chat is private to students. */
  messages: TeamMessage[] | null
  lastSeq: number
  lastSeenSeq: number | null
  presence: PresenceEntry[]
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

function omit<T>(record: Record<string, T>, id: string): Record<string, T> {
  const next = { ...record }
  delete next[id]
  return next
}

function byTime(a: TeamMessage, b: TeamMessage): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

export function fromSnapshot(state: TeamState): TeamStore {
  return {
    team: state.team,
    tasks: byId(state.tasks),
    milestones: byId(state.milestones),
    decisions: byId(state.decisions),
    documents: byId(state.documents),
    messages: state.messages ? [...state.messages].sort(byTime) : null,
    lastSeq: state.last_seq,
    lastSeenSeq: state.last_seen_seq,
    presence: [],
  }
}

export function upsertTask(store: TeamStore, task: TeamTask): TeamStore {
  return { ...store, tasks: { ...store.tasks, [task.id]: task } }
}

export function removeTask(store: TeamStore, taskId: string): TeamStore {
  const tasks = omit(store.tasks, taskId)
  for (const [id, task] of Object.entries(tasks)) {
    if (task.depends_on.includes(taskId)) tasks[id] = { ...task, depends_on: task.depends_on.filter((dep) => dep !== taskId) }
  }
  return { ...store, tasks }
}

export function moveTaskLocal(store: TeamStore, taskId: string, status: TaskStatus, position: number): TeamStore {
  const task = store.tasks[taskId]
  return task ? upsertTask(store, { ...task, status, position }) : store
}

export function upsertMilestone(store: TeamStore, milestone: TeamMilestone): TeamStore {
  return { ...store, milestones: { ...store.milestones, [milestone.id]: milestone } }
}

export function upsertDecision(store: TeamStore, decision: TeamDecision): TeamStore {
  return { ...store, decisions: { ...store.decisions, [decision.id]: decision } }
}

export function removeDecision(store: TeamStore, decisionId: string): TeamStore {
  return { ...store, decisions: omit(store.decisions, decisionId) }
}

export function upsertDocument(store: TeamStore, document: TeamDocumentInfo): TeamStore {
  return { ...store, documents: { ...store.documents, [document.id]: document } }
}

export function upsertSection(store: TeamStore, section: DocSectionInfo): TeamStore {
  const document = store.documents[section.document_id]
  if (!document) return store
  const exists = document.sections.some((item) => item.id === section.id)
  const sections = exists
    ? document.sections.map((item) => (item.id === section.id ? section : item))
    : [...document.sections, section].sort((a, b) => a.position - b.position)
  return upsertDocument(store, { ...document, sections })
}

function patchSection(store: TeamStore, sectionId: string, patch: Partial<DocSectionInfo>): TeamStore {
  for (const document of Object.values(store.documents)) {
    const section = document.sections.find((item) => item.id === sectionId)
    if (section) return upsertSection(store, { ...section, ...patch })
  }
  return store
}

export function upsertMessage(store: TeamStore, message: TeamMessage): TeamStore {
  if (!store.messages) return store
  const index = store.messages.findIndex((item) => item.id === message.id)
  if (index >= 0) {
    const messages = [...store.messages]
    messages[index] = message
    return { ...store, messages }
  }
  return { ...store, messages: [...store.messages, message].sort(byTime) }
}

function patchMessage(store: TeamStore, messageId: string, patch: Partial<TeamMessage>): TeamStore {
  const message = store.messages?.find((item) => item.id === messageId)
  return message ? upsertMessage(store, { ...message, ...patch }) : store
}

export function markMessageDeleted(store: TeamStore, messageId: string): TeamStore {
  return patchMessage(store, messageId, { deleted: true, content: "", metadata: null })
}

/** Set (not flip) one user's reaction, so the REST echo and the event agree. */
export function setReaction(store: TeamStore, messageId: string, userId: string, emoji: string, on: boolean): TeamStore {
  const message = store.messages?.find((item) => item.id === messageId)
  if (!message) return store
  const users = message.reactions[emoji] ?? []
  const nextUsers = on ? (users.includes(userId) ? users : [...users, userId]) : users.filter((id) => id !== userId)
  const reactions = { ...message.reactions }
  if (nextUsers.length) reactions[emoji] = nextUsers
  else delete reactions[emoji]
  return patchMessage(store, messageId, { reactions })
}

function addMember(store: TeamStore, userId: string, displayName: string): TeamStore {
  if (store.team.members.some((member) => member.user_id === userId)) return store
  const members = [...store.team.members, { user_id: userId, display_name: displayName, role_label: "", is_lead: false }]
  return { ...store, team: { ...store.team, members } }
}

function reduce(store: TeamStore, event: TeamEvent): TeamStore {
  const payload = event.payload
  const id = String(payload.id ?? "")
  switch (event.type) {
    case "task.created":
    case "task.updated":
      return upsertTask(store, payload as unknown as TeamTask)
    case "task.moved":
      return moveTaskLocal(store, id, payload.status as TaskStatus, Number(payload.position))
    case "task.deleted":
      return removeTask(store, id)
    case "milestone.created":
    case "milestone.updated":
    case "milestone.completed":
      return upsertMilestone(store, payload as unknown as TeamMilestone)
    case "decision.pinned":
      return upsertDecision(store, payload as unknown as TeamDecision)
    case "decision.removed":
      return removeDecision(store, id)
    case "message.created":
    case "message.edited":
      return upsertMessage(store, payload as unknown as TeamMessage)
    case "message.deleted":
      return markMessageDeleted(store, id)
    case "reaction.toggled":
      return setReaction(store, String(payload.message_id), String(payload.user_id), String(payload.emoji), Boolean(payload.on))
    case "document.created":
      return upsertDocument(store, payload as unknown as TeamDocumentInfo)
    case "section.updated":
      return upsertSection(store, payload as unknown as DocSectionInfo)
    case "section.locked":
      return patchSection(store, id, { lock_user_id: String(payload.lock_user_id), lock_expires_at: String(payload.lock_expires_at) })
    case "section.unlocked":
      return patchSection(store, id, { lock_user_id: null, lock_expires_at: null })
    case "member.joined":
      return addMember(store, String(payload.user_id), String(payload.display_name))
    default:
      return store
  }
}

/** Fold one stream event in. Events at or before the cursor were already seen. */
export function applyEvent(store: TeamStore, event: TeamEvent): TeamStore {
  if (event.seq <= store.lastSeq) return store
  return { ...reduce(store, event), lastSeq: event.seq }
}

export function memberName(store: TeamStore, userId: string | null): string {
  if (userId === null) return "Hermes"
  return store.team.members.find((member) => member.user_id === userId)?.display_name ?? "A classmate"
}

export function tasksByStatus(store: TeamStore): Record<TaskStatus, TeamTask[]> {
  const columns: Record<TaskStatus, TeamTask[]> = { todo: [], doing: [], review: [], done: [] }
  for (const task of Object.values(store.tasks)) (columns[task.status] ?? columns.todo).push(task)
  for (const list of Object.values(columns)) list.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  return columns
}

export function progressOf(store: TeamStore): number {
  const tasks = Object.values(store.tasks)
  const total = tasks.reduce((sum, task) => sum + task.estimate_points, 0)
  const done = tasks.filter((task) => task.status === "done").reduce((sum, task) => sum + task.estimate_points, 0)
  return total ? Math.round((100 * done) / total) : 0
}

export function isBlocked(store: TeamStore, task: TeamTask): boolean {
  return task.depends_on.some((id) => store.tasks[id] !== undefined && store.tasks[id].status !== "done")
}
