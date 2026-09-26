import { API_BASE, api, getCurrentStudentId, hermesRequestParts } from "@/lib/farq-api"

const ACTING_USER_STORAGE_KEY = "farq.current-user"
export const ACTING_USER_EVENT = "farq:acting-user-changed"

export type TeamRole = "lead" | "member" | "instructor"
export type TaskStatus = "todo" | "doing" | "review" | "done"
export type ProposalKind = "task_split" | "task_edit" | "doc_section" | "charter" | "milestones" | "section_owners"
export type ProposalStatus = "pending" | "applied" | "rejected" | "stale" | "awaiting_lead"
export type DocumentKind = "srs" | "sds" | "spmp" | "custom"

export interface TeamUser { id: string; display_name: string; role: "student" | "instructor"; student_id: string | null }
export interface CourseRef { id: string; code: string; title: string; term: string }
export interface Criterion { id: string; title: string; description: string; weight: number }
export interface AssignmentInfo {
  id: string; course_id: string; title: string; brief: Record<string, unknown>; deadline: string | null
  deliverables: string[]; rubric: Criterion[]; team_size_min: number; team_size_max: number
}
export interface TeamCharter { goal?: string; roles?: Record<string, string>; working_agreement?: string[]; meetings?: string }
export interface TeamMemberInfo { user_id: string; display_name: string; role_label: string; is_lead: boolean }
export interface TeamInfo {
  id: string; name: string; cover_seed: string; lead_user_id: string; charter: TeamCharter; created_at: string
  viewer_role: TeamRole; assignment: AssignmentInfo; course: CourseRef; members: TeamMemberInfo[]
}
export interface TeamCard {
  id: string; name: string; cover_seed: string; course: CourseRef
  assignment: { id: string; title: string; deadline: string | null }
  progress: number; next_task: { id: string; title: string; estimate_points: number; status: TaskStatus } | null
  members: string[]; unread: number | null; viewer_role: TeamRole; risk: string | null
}
export interface NeedsTeam {
  assignment_id: string; title: string; deadline: string | null; course: CourseRef
  team_size_min: number; team_size_max: number; open_classmates: number
}
export interface TeamInvite {
  id: string; team_id: string; team_name: string; assignment_title: string; invited_user_id: string
  invited_by_name: string; status: string; created_at: string
}
export interface TeamsHomeData { user: TeamUser; teams: TeamCard[]; needs_team: NeedsTeam[]; invites: TeamInvite[] }
export interface TeamTask {
  id: string; team_id: string; title: string; description: string; status: TaskStatus; assignee_id: string | null
  estimate_points: number; due: string | null; depends_on: string[]; milestone_id: string | null; rubric_refs: string[]
  rationale: string; created_by: "user" | "hermes"; position: number; created_at: string; updated_at: string
}
export interface TeamMilestone { id: string; team_id: string; title: string; due: string | null; deliverable_key: string | null; completed_at: string | null }
export interface TeamMessage {
  id: string; team_id: string; author_user_id: string | null; kind: "text" | "notice" | "proposal" | "poll" | "system"
  content: string; metadata: Record<string, unknown> | null; reply_to_id: string | null; visible_to_user_id: string | null
  created_at: string; edited_at: string | null; deleted: boolean; reactions: Record<string, string[]>
}
export interface TeamDecision { id: string; team_id: string; text: string; source_message_id: string | null; pinned_by: string; created_at: string }
export interface TeamProposal {
  id: string; team_id: string; scope: "personal" | "team"; affected_user_id: string | null; kind: ProposalKind; summary: string
  payload: Record<string, unknown>; status: ProposalStatus; votes: Record<string, "up" | "down">; invoked_by: string | null
  created_at: string; expires_at: string; decided_at: string | null; decided_by: string | null
  /** Present on proposal.stale events: why it no longer applies. */
  reason?: string
}
export interface SplitTaskPayload { title: string; description?: string; assignee_id: string; estimate_points: number; rationale: string }
export interface HermesRunInfo { id: string; team_id: string; status: "queued" | "running" | "completed" | "failed"; stage: string; command: string; invoked_by: string }
export interface TeamRisk { key: string; kind: "deadline" | "blocked" | "quiet"; text: string; private: boolean }
export interface DocSectionInfo {
  id: string; document_id: string; key: string; title: string; position: number; owner_user_id: string | null
  content_md: string; status: "empty" | "draft" | "accepted"; lock_user_id: string | null; lock_expires_at: string | null
  version: number; meta: Record<string, unknown>
}
export interface TeamDocumentInfo { id: string; team_id: string; kind: DocumentKind; title: string; created_at: string; sections: DocSectionInfo[] }
export interface TeamState {
  team: TeamInfo; tasks: TeamTask[]; milestones: TeamMilestone[]; decisions: TeamDecision[]; documents: TeamDocumentInfo[]
  messages: TeamMessage[] | null; proposals: TeamProposal[]; last_seq: number; last_seen_seq: number | null
}
export interface TeamEvent { seq: number; type: string; actor_user_id: string | null; payload: Record<string, unknown>; created_at: string | null }
export interface PresenceEntry { user_id: string; focus: string | null; typing: boolean }
export interface ContributionRow { user_id: string; display_name: string; done_points: number; done_tasks: number; open_points: number; messages: number | null }
export interface Classmate { user_id: string; display_name: string; has_team: boolean }

export interface TaskInput {
  title: string; description?: string; assignee_id?: string | null; estimate_points?: number; due?: string | null
  depends_on?: string[]; milestone_id?: string | null; rubric_refs?: string[]; rationale?: string
}
export interface MessageInput { content: string; reply_to_id?: string | null; poll_options?: string[]; provider?: string; model?: string }
export interface MilestoneInput { title: string; due?: string | null; deliverable_key?: string | null }

/** Who team features act as in this tab. Per tab (sessionStorage) so two
 * windows can demo two classmates at once. Defaults to the demo student. */
export function getActingUserId(): string {
  if (typeof window === "undefined") return getCurrentStudentId()
  try {
    return window.sessionStorage.getItem(ACTING_USER_STORAGE_KEY) || getCurrentStudentId()
  } catch {
    return getCurrentStudentId()
  }
}

export function setActingUserId(id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(ACTING_USER_STORAGE_KEY, id)
    else window.sessionStorage.removeItem(ACTING_USER_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the event still switches this tab.
  }
  window.dispatchEvent(new Event(ACTING_USER_EVENT))
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong"
}

function send(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) }
}

export function demoUsers(): Promise<TeamUser[]> {
  return api<TeamUser[]>("/api/demo/users")
}

/** A client that always acts as `userId`. Bound once per view so a View-as
 * switch (or another tab) can never make an in-flight view act as someone else. */
export function teamClient(userId: string) {
  function teamApi<T>(path: string, init?: RequestInit): Promise<T> {
    return api<T>(path, { ...init, headers: { "X-Farq-User": userId, ...(init?.headers as Record<string, string> | undefined) } })
  }
  return {
  userId,
  home: () => teamApi<TeamsHomeData>("/api/me/teams-home"),
  classmates: (assignmentId: string) => teamApi<Classmate[]>(`/api/assignments/${assignmentId}/classmates`),
  createTeam: (assignmentId: string, name: string) => teamApi<TeamInfo>(`/api/assignments/${assignmentId}/teams`, send("POST", { name })),
  invite: (teamId: string, userId: string) => teamApi<TeamInvite>(`/api/teams/${teamId}/invites`, send("POST", { user_id: userId })),
  acceptInvite: (inviteId: string) => teamApi<TeamInfo>(`/api/invites/${inviteId}/accept`, send("POST")),
  declineInvite: (inviteId: string) => teamApi<TeamInvite>(`/api/invites/${inviteId}/decline`, send("POST")),
  state: (teamId: string) => teamApi<TeamState>(`/api/teams/${teamId}/state`),
  contribution: (teamId: string) => teamApi<{ members: ContributionRow[] }>(`/api/teams/${teamId}/contribution`),
  createTask: (teamId: string, body: TaskInput) => teamApi<TeamTask>(`/api/teams/${teamId}/tasks`, send("POST", body)),
  updateTask: (taskId: string, body: Partial<TaskInput>) => teamApi<TeamTask>(`/api/tasks/${taskId}`, send("PATCH", body)),
  moveTask: (taskId: string, status: TaskStatus, position?: number) =>
    teamApi<TeamTask>(`/api/tasks/${taskId}/move`, send("POST", { status, position: position ?? null })),
  deleteTask: (taskId: string) => teamApi<{ id: string }>(`/api/tasks/${taskId}`, send("DELETE")),
  createMilestone: (teamId: string, body: MilestoneInput) => teamApi<TeamMilestone>(`/api/teams/${teamId}/milestones`, send("POST", body)),
  postMessage: (teamId: string, body: MessageInput) => {
    // Hermes may answer this message, so send the tab's model choice and key like the Coach does.
    const hermes = hermesRequestParts()
    return teamApi<TeamMessage>(`/api/teams/${teamId}/messages`, { ...send("POST", { ...hermes.body, ...body }), headers: hermes.headers })
  },
  editMessage: (messageId: string, content: string) => teamApi<TeamMessage>(`/api/messages/${messageId}`, send("PATCH", { content })),
  deleteMessage: (messageId: string) => teamApi<{ id: string }>(`/api/messages/${messageId}`, send("DELETE")),
  react: (messageId: string, emoji: string) =>
    teamApi<{ message_id: string; user_id: string; emoji: string; on: boolean }>(`/api/messages/${messageId}/reactions`, send("POST", { emoji })),
  votePoll: (messageId: string, option: number) => teamApi<TeamMessage>(`/api/messages/${messageId}/poll-vote`, send("POST", { option })),
  pin: (teamId: string, messageId: string) => teamApi<TeamDecision>(`/api/teams/${teamId}/decisions`, send("POST", { message_id: messageId })),
  unpin: (decisionId: string) => teamApi<{ id: string }>(`/api/decisions/${decisionId}`, send("DELETE")),
  vote: (proposalId: string, choice: "up" | "down") => teamApi<TeamProposal>(`/api/proposals/${proposalId}/vote`, send("POST", { vote: choice })),
  acceptProposal: (proposalId: string) => teamApi<TeamProposal>(`/api/proposals/${proposalId}/accept`, send("POST")),
  rejectProposal: (proposalId: string) => teamApi<TeamProposal>(`/api/proposals/${proposalId}/reject`, send("POST")),
  risks: (teamId: string) => teamApi<TeamRisk[]>(`/api/teams/${teamId}/risks`),
  markSeen: (teamId: string, seq: number) => teamApi<{ last_seen_seq: number }>(`/api/teams/${teamId}/seen`, send("POST", { seq })),
  createDocument: (teamId: string, kind: DocumentKind) => teamApi<TeamDocumentInfo>(`/api/teams/${teamId}/documents`, send("POST", { kind })),
  updateSection: (sectionId: string, body: { title?: string; owner_user_id?: string | null }) =>
    teamApi<DocSectionInfo>(`/api/sections/${sectionId}`, send("PATCH", body)),
  lockSection: (sectionId: string) => teamApi<DocSectionInfo>(`/api/sections/${sectionId}/lock`, send("POST")),
  unlockSection: (sectionId: string) => teamApi<DocSectionInfo>(`/api/sections/${sectionId}/unlock`, send("POST")),
  saveSection: (sectionId: string, contentMd: string, version: number) =>
    teamApi<DocSectionInfo>(`/api/sections/${sectionId}/content`, send("PUT", { content_md: contentMd, version })),
  presence: (teamId: string, focus: string | null) => teamApi<{ ok: boolean }>(`/api/teams/${teamId}/presence`, send("POST", { focus })),
  typing: (teamId: string) => teamApi<{ ok: boolean }>(`/api/teams/${teamId}/typing`, send("POST")),
  eventsUrl: (teamId: string, after: number) =>
    `${API_BASE}/api/teams/${teamId}/events?as=${encodeURIComponent(userId)}&after=${after}`,
  }
}

export type TeamClient = ReturnType<typeof teamClient>
