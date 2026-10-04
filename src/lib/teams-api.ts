import { translate } from "@/lib/i18n/context"
import { API_BASE, api, getCurrentStudentId } from "@/lib/waypoint-api"

const ACTING_USER_STORAGE_KEY = "waypoint.current-user"
export const ACTING_USER_EVENT = "waypoint:acting-user-changed"

export type TeamRole = "lead" | "member" | "instructor"
export type TaskStatus = "todo" | "doing" | "review" | "done"
export type ProposalKind =
  | "task_split" | "task_edit" | "task_delete" | "task_reorganize" | "task_merge" | "doc_section" | "charter" | "milestones"
  | "section_owners" | "brief" | "deliverables" | "rubric" | "batch"
export type ProposalStatus = "pending" | "applied" | "rejected" | "stale" | "awaiting_lead"
export type DocumentKind = "srs" | "sds" | "spmp" | "custom"
export type ExportFormat = "md" | "docx" | "html"
export type ExportStyle = "ieee" | "modern"

export interface TeamUser { id: string; display_name: string; role: "student" | "instructor"; student_id: string | null }
export interface CourseRef { id: string; code: string; title: string; term: string }
export interface Criterion { id: string; title: string; description: string; weight: number }
export interface AssignmentInfo {
  id: string; course_id: string; title: string; brief: Record<string, unknown>; deadline: string | null
  deliverables: string[]; rubric: Criterion[]; team_size_min: number; team_size_max: number
}
export interface TeamCharter { goal?: string; roles?: Record<string, string>; working_agreement?: string[]; meetings?: string }
export interface ProjectBrief { problem?: string; objective?: string; scope?: string; constraints?: string[]; tools?: string[] }
export interface ProjectDeliverable { key: string; title: string; due: string | null; doc_kind: "srs" | "sds" | "spmp" | null }
export interface ProjectCriterion { name: string; weight: number; description: string }
/** The team's own project from an accepted import; empty where the assignment's brief applies. */
export interface TeamProject { brief: ProjectBrief; deliverables: ProjectDeliverable[]; rubric: ProjectCriterion[] }
export type ImportRowKind = "brief" | "deliverable" | "milestone" | "criterion"
export interface ImportRow {
  id: string; kind: ImportRowKind; data: Record<string, unknown>; source_quote: string; confidence: "stated" | "inferred"
}
export interface TeamImportInfo {
  id: string; team_id: string; uploaded_by: string; filename: string
  /** reading: Hermes is extracting in the background; failed carries `error` until dismissed. */
  status: "reading" | "review" | "failed" | "proposed" | "discarded"
  items: ImportRow[]; proposal_id: string | null; error: string | null; created_at: string
}
export interface TeamMemberInfo { user_id: string; display_name: string; role_label: string; is_lead: boolean }
export interface TeamInfo {
  id: string; name: string; cover_seed: string; lead_user_id: string; charter: TeamCharter; created_at: string
  viewer_role: TeamRole; assignment: AssignmentInfo; course: CourseRef; members: TeamMemberInfo[]; size_limit: number
  project: TeamProject
}
export interface TeamCard {
  id: string; name: string; cover_seed: string; course: CourseRef
  assignment: { id: string; title: string; deadline: string | null }
  progress: number; next_task: { id: string; title: string; estimate_points: number; status: TaskStatus } | null
  members: string[]; unread: number | null; viewer_role: TeamRole; risk: string | null
  /** True once the lead moved this computer's copy to the shared service (it is read-only now). */
  moved?: boolean
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
  /** "lead_override" when the lead decided it directly instead of the vote or the affected member. */
  decided_via: "lead_override" | null
  /** Advisory notes (uneven workload, rubric not totalling 100); they never block the vote. */
  warnings: string[]
  /** Present on proposal.stale events: why it no longer applies. */
  reason?: string
}
export interface SplitTaskPayload { title: string; description?: string; assignee_id: string; estimate_points: number; rationale: string }
export interface HermesRunInfo { id: string; team_id: string; status: "queued" | "running" | "completed" | "failed"; stage: string; command: string; invoked_by: string }
export interface ActivityEntry { seq: number; at: string | null; actor_user_id: string | null; actor: string; kind: string; text: string }
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
  /** Imports being read, waiting for review, or failed. */
  imports?: TeamImportInfo[]
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
  return reason instanceof Error ? reason.message : translate("teams.errors.generic")
}

function send(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) }
}

export function demoUsers(): Promise<TeamUser[]> {
  return api<TeamUser[]>("/api/demo/users")
}

/** A client that always acts as `userId`. Bound once per view so a View-as
 * switch (or another tab) can never make an in-flight view act as someone else. */
export interface TeamEventSource extends EventTarget { close(): void; onopen: (() => void) | null; onerror: (() => void) | null }
export interface TeamTransport {
  mode: "central"
  teamAI: boolean
  projectImport: boolean
  request<T>(path: string, init?: RequestInit): Promise<T>
  raw(path: string, init?: RequestInit): Promise<Response>
  events(teamId: string, after: number): TeamEventSource
}

export interface JoinRequestInfo {
  id: string; team_id: string; team_name: string; account_id: string; display_name: string; note: string
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired"; expires_at: string
}

export interface SharedProfileBody {
  skills: string[]; roles: string[]; interests: string[]; goals: string[]; languages: string[]; timezone: string
  meeting_slots: number[]; hours_per_week: number | null; looking: boolean
}
export interface DiscoveryPreferences {
  desired_skills: string[]; required_skills: string[]; required_languages: string[]; min_hours: number | null
  required_meeting_slots: number[]; team_size: number
}
export interface ProfileMatches {
  policy: string; bounded: boolean; eligible_candidates: number; explored: number
  teams: Array<{ score: number; members: Array<{ account_id: string; display_name: string; version: number }>;
    factors: { desired_skills_covered: string[]; complementary_skills: string[]; shared_interests: string[]; role_variety: string[]; common_meeting_slots: number[] };
    missing: { schedule_count: number; commitment_count: number } }>
}

export interface ExistingTeamMatches {
  policy: string; bounded: boolean
  teams: Array<Omit<ProfileMatches["teams"][number], "members"> & { team_id: string; team_name: string; summary: string; roles: string[]; commitment: string; places: number; unknown_profiles: number; snapshot: string }>
}

export function teamClient(userId: string, transport?: TeamTransport) {
  function teamApi<T>(path: string, init?: RequestInit): Promise<T> {
    if (transport) return transport.request<T>(path, init)
    return api<T>(path, { ...init, headers: { "X-Waypoint-User": userId, ...(init?.headers as Record<string, string> | undefined) } })
  }
  return {
  userId,
  central: Boolean(transport),
  teamAI: transport?.teamAI ?? true,
  projectImport: transport?.projectImport ?? true,
  createRoom: (name: string) => teamApi<TeamInfo>("/api/teams", send("POST", { name })),
  classes: () => teamApi<Array<{ id: string; title: string; code: string; organizer: boolean; archived: boolean }>>("/api/classes"),
  createClass: (title: string) => teamApi<{ id: string }>("/api/classes", send("POST", { title })),
  classDetail: (id: string) => teamApi<{ id: string; title: string; organizer: boolean; archived: boolean; members: Array<{ id: string; display_name: string }>; assignments: Array<{ id: string; title: string }> }>(`/api/classes/${id}`),
  transferOrganizer: (id: string, account: string) => teamApi(`/api/classes/${id}/organizer`, send("POST", { account_id: account })),
  archiveClass: (id: string, action: "archive" | "restore") => teamApi(`/api/classes/${id}/${action}`, send("POST")),
  archiveProject: (id: string, action: "archive" | "restore") => teamApi(`/api/teams/${id}/${action}`, send("POST")),
  archivedProjects: () => teamApi<Array<{ id: string; name: string; can_restore: boolean; class_archived: boolean }>>("/api/me/archived-teams"),
  editProjectDetails: (id: string, body: { project?: { brief: ProjectBrief; deliverables: ProjectDeliverable[] }; assignment?: { title: string; problem: string; objective: string; deliverables: string[]; constraints: string[] } }) => teamApi<TeamInfo>(`/api/teams/${id}/project-details`, send("PATCH", body)),
  leaveTeam: (id: string) => teamApi<{ left: boolean }>(`/api/teams/${id}/leave`, send("POST")),
  ownTeamProfile: (id: string) => teamApi<{ version: number; published: boolean; discovery: boolean; profile: SharedProfileBody }>(`/api/teams/${id}/profile`),
  publishTeamProfile: (id: string, version: number, profile: SharedProfileBody, discovery: boolean) => teamApi(`/api/teams/${id}/profile`, send("PUT", { reviewed: true, expected_version: version, profile, discovery })),
  withdrawTeamProfile: (id: string, version: number) => teamApi(`/api/teams/${id}/profile/withdraw`, send("POST", { expected_version: version })),
  teamProfiles: (id: string) => teamApi<Array<{ account_id: string; display_name: string; profile: SharedProfileBody }>>(`/api/teams/${id}/profiles`),
  existingTeamMatches: (id: string, assignment: string) => teamApi<ExistingTeamMatches>(`/api/classes/${id}/discovery/team-matches`, send("POST", { assignment_id: assignment })),
  ownProfile: (id: string) => teamApi<{ version: number; published: boolean; profile: SharedProfileBody }>(`/api/classes/${id}/profile`),
  publishProfile: (id: string, version: number, profile: SharedProfileBody) => teamApi(`/api/classes/${id}/profile`, send("PUT", { reviewed: true, expected_version: version, profile })),
  withdrawProfile: (id: string, version: number) => teamApi(`/api/classes/${id}/profile/withdraw`, send("POST", { expected_version: version })),
  preferences: (id: string) => teamApi<DiscoveryPreferences>(`/api/classes/${id}/preferences`),
  savePreferences: (id: string, body: DiscoveryPreferences) => teamApi(`/api/classes/${id}/preferences`, send("PUT", body)),
  profileMatches: (id: string, assignment: string) => teamApi<ProfileMatches>(`/api/classes/${id}/discovery/matches`, send("POST", { assignment_id: assignment })),
  candidateProfile: (id: string, account: string, version: number) => teamApi<{ display_name: string; profile: SharedProfileBody }>(`/api/classes/${id}/profiles/${account}?version=${version}`),
  createAssignment: (id: string, title: string) => teamApi(`/api/classes/${id}/assignments`, send("POST", { title })),
  issueCode: (scope: "classes" | "teams", id: string) => teamApi<{ id: string; code: string; expires_at: string }>(`/api/${scope}/${id}/codes`, send("POST", {})),
  revokeCode: (id: string) => teamApi(`/api/codes/${id}`, send("DELETE")),
  redeemCode: (code: string) => teamApi<{ team_id?: string; class_id?: string }>("/api/codes/redeem", send("POST", { code })),
  removeClassMember: (id: string, account: string) => teamApi(`/api/classes/${id}/members/${account}`, send("DELETE")),
  transferLead: (id: string, account: string) => teamApi(`/api/teams/${id}/lead`, send("POST", { user_id: account })),
  openings: (id: string) => teamApi<Array<{ team_id: string; team_name: string; assignment_title: string; summary: string; roles: string[]; commitment: string; places: number; expires_at: string; request: JoinRequestInfo | null }>>(`/api/classes/${id}/openings`),
  opening: (id: string) => teamApi<{ open: boolean; summary: string; roles: string[]; commitment: string }>(`/api/teams/${id}/opening`),
  publishOpening: (id: string, body: { summary: string; roles: string[]; commitment: string }) => teamApi(`/api/teams/${id}/opening`, send("PUT", body)),
  closeOpening: (id: string) => teamApi(`/api/teams/${id}/opening`, send("DELETE")),
  requestJoin: (id: string, note: string, match_snapshot?: string) => teamApi<JoinRequestInfo>(`/api/teams/${id}/join-requests`, send("POST", { note, match_snapshot })),
  joinRequests: (id: string) => teamApi<JoinRequestInfo[]>(`/api/teams/${id}/join-requests`),
  myJoinRequests: () => teamApi<JoinRequestInfo[]>("/api/me/join-requests"),
  decideJoin: (id: string, decision: "accept" | "decline" | "cancel") => teamApi(`/api/join-requests/${id}/${decision}`, send("POST")),
  openEvents: (teamId: string, after: number): TeamEventSource => transport
    ? transport.events(teamId, after)
    : new EventSource(`${API_BASE}/api/teams/${teamId}/events?as=${encodeURIComponent(userId)}&after=${after}`) as TeamEventSource,
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
  postMessage: (teamId: string, body: MessageInput) => teamApi<TeamMessage>(`/api/teams/${teamId}/messages`, send("POST", body)),
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
  importProject: (teamId: string, source: { file: File } | { text: string }) => {
    const form = new FormData()
    if ("file" in source) form.append("file", source.file)
    else form.append("text", source.text)
    return teamApi<TeamImportInfo>(`/api/teams/${teamId}/imports`, { method: "POST", body: form })
  },
  proposeImport: (importId: string, items: { kind: ImportRowKind; data: Record<string, unknown> }[]) =>
    teamApi<{ import: TeamImportInfo; proposal: TeamProposal }>(`/api/imports/${importId}/propose`, send("POST", { items })),
  discardImport: (importId: string) => teamApi<TeamImportInfo>(`/api/imports/${importId}/discard`, send("POST")),
  risks: (teamId: string) => teamApi<TeamRisk[]>(`/api/teams/${teamId}/risks`),
  markSeen: (teamId: string, seq: number) => teamApi<{ last_seen_seq: number }>(`/api/teams/${teamId}/seen`, send("POST", { seq })),
  createDocument: (teamId: string, kind: DocumentKind, custom?: { title: string; sections: { key: string; title: string }[] }) =>
    teamApi<TeamDocumentInfo>(`/api/teams/${teamId}/documents`, send("POST", { kind, ...custom })),
  renameDocument: (documentId: string, title: string) => teamApi<TeamDocumentInfo>(`/api/documents/${documentId}`, send("PATCH", { title })),
  addSection: (documentId: string, body: { key: string; title: string; after_section_id?: string | null }) =>
    teamApi<DocSectionInfo>(`/api/documents/${documentId}/sections`, send("POST", body)),
  moveSection: (sectionId: string, direction: "up" | "down") =>
    teamApi<TeamDocumentInfo>(`/api/sections/${sectionId}/move`, send("POST", { direction })),
  deleteSection: (sectionId: string) => teamApi<TeamDocumentInfo>(`/api/sections/${sectionId}`, send("DELETE")),
  /** The file itself (not JSON), so this bypasses `api` and returns the response body as a Blob. */
  exportDocument: async (documentId: string, format: ExportFormat, style: ExportStyle): Promise<Blob> => {
    if (transport) return (await transport.raw(`/api/documents/${documentId}/export?format=${format}&style=${style}`)).blob()
    const response = await fetch(`${API_BASE}/api/documents/${documentId}/export?format=${format}&style=${style}`, { headers: { "X-Waypoint-User": userId } })
    if (!response.ok) throw new Error(translate("teams.errors.exportFailed", { status: String(response.status) }))
    return response.blob()
  },
  activity: (teamId: string, before?: number) =>
    teamApi<{ entries: ActivityEntry[]; next_before: number | null }>(`/api/teams/${teamId}/activity${before ? `?before=${before}` : ""}`),
  updateTeam: (teamId: string, body: { name?: string; size_limit?: number }) => teamApi<TeamInfo>(`/api/teams/${teamId}`, send("PATCH", body)),
  updateSection: (sectionId: string, body: { key?: string; title?: string; owner_user_id?: string | null }) =>
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
