import type { ActivityEntry, DocSectionInfo, TeamDocumentInfo, TeamEvent, TeamEventSource, TeamInfo, TeamMessage, TeamProposal, TeamState, TeamTask, TeamTransport, TeamsHomeData } from "./teams-api"
import { DEMO_TEAM_USER, DEMO_TEAMS_CHANGED, DEMO_TEAMS_STORAGE_KEY, freshDemoTeams, type DemoData } from "./demo-teams-seed"

type DemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const now = () => new Date().toISOString()
const id = () => `demo-local-${crypto.randomUUID()}`
const fail = (message: string): never => { throw new Error(message) }

class DemoEvents extends EventTarget implements TeamEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private closed = false
  private detach: () => void
  constructor(detach: () => void) {
    super()
    this.detach = detach
    // Registration happens in the caller immediately after constructing the source.
    queueMicrotask(() => { if (!this.closed) this.onopen?.() })
  }
  emit(event: TeamEvent) {
    if (!this.closed) this.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) }))
  }
  close() { this.closed = true; this.detach() }
}

/** An isolated browser sandbox. There is deliberately no HTTP client, token, or network fallback. */
export class DemoTeamSandbox {
  private data: DemoData
  private sources = new Map<string, Set<DemoEvents>>()
  private pending: Array<{ teamId: string; event: TeamEvent }> = []
  private storage: DemoStorage | null
  constructor(storage: DemoStorage | null = null) {
    this.storage = storage
    this.data = freshDemoTeams()
    try {
      const raw = storage?.getItem(DEMO_TEAMS_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as DemoData
        if (saved.version === 1 && Array.isArray(saved.classes) && Array.isArray(saved.joined)
          && Array.isArray(saved.archived) && Array.isArray(saved.invites) && saved.codes && saved.activity
          && saved.events && Array.isArray(saved.requests)
          && Array.isArray(saved.openings) && saved.teams && Object.values(saved.teams).every(state =>
            state.team && Array.isArray(state.team.members) && Array.isArray(state.tasks) && Array.isArray(state.documents)
            && Array.isArray(state.messages) && Array.isArray(state.proposals) && Array.isArray(state.milestones) && Array.isArray(state.decisions))) this.data = saved
      }
    } catch { /* A broken or unavailable browser store starts with the clean demo. */ }
  }
  private persist() {
    try { this.storage?.setItem(DEMO_TEAMS_STORAGE_KEY, JSON.stringify(this.data)) } catch { /* Still usable in memory. */ }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(DEMO_TEAMS_CHANGED))
  }
  reset() {
    this.data = freshDemoTeams()
    this.persist()
    for (const sources of this.sources.values()) for (const source of [...sources]) source.close()
  }
  private state(teamId: string, requireMember = true): TeamState {
    const state = this.data.teams[teamId] ?? fail("This demo project does not exist.")
    if (requireMember && (!this.data.joined.includes(teamId) || !state.team.members.some(m => m.user_id === DEMO_TEAM_USER))) fail("You are not a member of this demo project.")
    return state
  }
  private lead(state: TeamState) {
    if (state.team.lead_user_id !== DEMO_TEAM_USER) fail("Only this project's leader can make that change.")
  }
  private emit(state: TeamState, type: string, payload: object, text: string) {
    const event: TeamEvent = { seq: ++state.last_seq, type, actor_user_id: DEMO_TEAM_USER, payload: copy(payload) as Record<string, unknown>, created_at: now() }
    const entry: ActivityEntry = { seq: event.seq, at: event.created_at, actor_user_id: DEMO_TEAM_USER, actor: "Demo Student", kind: type, text }
    const entries = this.data.activity[state.team.id] ??= []
    entries.push(entry)
    const events = this.data.events[state.team.id] ??= []
    events.push(event)
    this.pending.push({ teamId: state.team.id, event })
  }
  private join(teamId: string): TeamInfo {
    const state = this.state(teamId, false)
    if (!this.data.joined.includes(teamId)) {
      if (state.team.members.length >= state.team.size_limit) fail("This demo project is full.")
      this.data.joined.push(teamId)
      if (!state.team.members.some(m => m.user_id === DEMO_TEAM_USER)) state.team.members.push({ user_id: DEMO_TEAM_USER, display_name: "Demo Student", role_label: "", is_lead: false })
      state.team.viewer_role = state.team.lead_user_id === DEMO_TEAM_USER ? "lead" : "member"
      this.emit(state, "member.joined", { user_id: DEMO_TEAM_USER, display_name: "Demo Student" }, "Joined the project")
    }
    return state.team
  }
  private home(): TeamsHomeData {
    const states = this.data.joined.filter(teamId => !this.data.archived.includes(teamId)
      && !this.data.classes.find(c => c.id === this.data.teams[teamId].team.course.id)?.archived).map(teamId => this.state(teamId))
    return {
      user: { id: DEMO_TEAM_USER, display_name: "Demo Student", role: "student", student_id: DEMO_TEAM_USER },
      teams: states.map(state => {
        const points = state.tasks.reduce((sum, task) => sum + task.estimate_points, 0)
        return { id: state.team.id, name: state.team.name, cover_seed: state.team.cover_seed, course: state.team.course,
          assignment: { id: state.team.assignment.id, title: state.team.assignment.title, deadline: state.team.assignment.deadline },
          progress: points ? Math.round(100 * state.tasks.filter(t => t.status === "done").reduce((sum, t) => sum + t.estimate_points, 0) / points) : 0,
          next_task: state.tasks.find(t => t.assignee_id === DEMO_TEAM_USER && t.status !== "done") ?? null,
          members: state.team.members.map(m => m.display_name), unread: Math.max(0, state.last_seq - (state.last_seen_seq ?? 0)),
          viewer_role: state.team.viewer_role, risk: null }
      }),
      invites: this.data.invites.filter(invite => invite.status === "pending" && invite.invited_user_id === DEMO_TEAM_USER),
      needs_team: this.data.classes.filter(c => c.joined && !c.archived).flatMap(c => c.assignments.filter(a =>
        !this.data.joined.some(teamId => this.data.teams[teamId].team.assignment.id === a.id)
        && !this.data.invites.some(invite => invite.status === "pending" && this.data.teams[invite.team_id].team.assignment.id === a.id))
        .map(a => ({ assignment_id: a.id, title: a.title, deadline: a.deadline, course: this.data.teams["demo-energy"].team.course.id === c.id
          ? this.data.teams["demo-energy"].team.course : this.data.teams["demo-campus"].team.course,
          team_size_min: a.team_size_min, team_size_max: a.team_size_max, open_classmates: 2 }))),
    }
  }
  private createTask(state: TeamState, body: Partial<TeamTask>): TeamTask {
    const title = body.title?.trim() || fail("Give the task a title.")
    const task: TeamTask = { id: id(), team_id: state.team.id, title, description: body.description ?? "", status: "todo",
      assignee_id: body.assignee_id ?? null, estimate_points: body.estimate_points ?? 2, due: body.due ?? null,
      depends_on: body.depends_on ?? [], milestone_id: body.milestone_id ?? null, rubric_refs: body.rubric_refs ?? [],
      rationale: body.rationale ?? "", created_by: "user", position: state.tasks.length * 1000, created_at: now(), updated_at: now() }
    state.tasks.push(task)
    this.emit(state, "task.created", task, `Created task: ${title}`)
    return task
  }
  private createProject(name: string, assignmentId?: string): TeamInfo {
    if (name.trim().length < 2) fail("Give the project a name.")
    const template = freshDemoTeams().teams["demo-campus"]
    const assignment = assignmentId ? this.data.classes.flatMap(c => c.assignments).find(a => a.id === assignmentId) : undefined
    if (assignmentId && !assignment) fail("This assignment does not exist in the demo.")
    const teamId = id()
    const state: TeamState = { team: { ...template.team, id: teamId, name: name.trim(), cover_seed: teamId, created_at: now(),
      assignment: assignment ?? { ...template.team.assignment, id: `${teamId}-assignment`, title: name.trim() },
      course: assignment ? this.data.teams["demo-energy"].team.course.id === assignment.course_id ? this.data.teams["demo-energy"].team.course : template.team.course : template.team.course,
      members: [template.team.members[0]], project: { brief: {}, deliverables: [], rubric: [] } },
      tasks: [], milestones: [], documents: [], messages: [], decisions: [], proposals: [], imports: [], last_seq: 0, last_seen_seq: 0 }
    this.data.teams[teamId] = state; this.data.joined.push(teamId)
    this.emit(state, "team.updated", state.team, "Created a project in this browser")
    return state.team
  }
  private find<K extends "tasks" | "messages" | "decisions" | "documents" | "proposals">(collection: K, itemId: string) {
    for (const state of Object.values(this.data.teams)) {
      const item = state[collection]?.find(item => item.id === itemId)
      if (item) { this.state(state.team.id); return { state, item } as { state: TeamState; item: NonNullable<TeamState[K]>[number] } }
    }
    return fail("This item does not exist in the demo.")
  }
  private section(sectionId: string) {
    for (const state of Object.values(this.data.teams)) for (const document of state.documents) {
      const section = document.sections.find(section => section.id === sectionId)
      if (section) { this.state(state.team.id); return { state, document, section } }
    }
    return fail("This document section does not exist.")
  }
  private proposal(state: TeamState, proposal: TeamProposal, action: string, vote: "up" | "down") {
    if (!["pending", "awaiting_lead"].includes(proposal.status)) fail("This proposal has already been decided.")
    if (action === "vote") {
      proposal.votes[DEMO_TEAM_USER] = vote
      this.emit(state, "proposal.voted", proposal, "Voted on a sample proposal")
      if (Object.values(proposal.votes).filter(v => v === "up").length <= state.team.members.length / 2) return proposal
      action = "accept"
    } else this.lead(state)
    if (action === "accept") {
      // The bundled demo only proposes adding tasks; no completed or in-progress task is changed.
      if (proposal.kind !== "task_split") fail("This sample proposal cannot be applied in the demo.")
      for (const task of proposal.payload.tasks as Partial<TeamTask>[]) this.createTask(state, task)
    }
    proposal.status = action === "accept" ? "applied" : "rejected"
    proposal.decided_at = now(); proposal.decided_by = DEMO_TEAM_USER
    proposal.decided_via = state.team.lead_user_id === DEMO_TEAM_USER ? "lead_override" : null
    this.emit(state, `proposal.${proposal.status}`, proposal, `${action === "accept" ? "Applied" : "Rejected"} a sample proposal`)
    return proposal
  }
  private route(path: string, init?: RequestInit): unknown {
    const url = new URL(path, "https://demo.invalid")
    const [prefix, collection, itemId, action, subId] = url.pathname.split("/").slice(1)
    if (prefix !== "api") fail("This action is unavailable in the demo.")
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {}
    const value = <T,>(key: string, fallback: T): T => body[key] === undefined ? fallback : body[key] as T
    if (collection === "me") {
      if (itemId === "teams-home") return this.home()
      if (itemId === "join-requests") return this.data.requests.filter(r => r.account_id === DEMO_TEAM_USER)
      if (itemId === "archived-teams") return this.data.archived.filter(teamId => this.data.joined.includes(teamId)).map(teamId => ({ id: teamId,
        name: this.state(teamId).team.name, can_restore: this.state(teamId).team.lead_user_id === DEMO_TEAM_USER,
        class_archived: !!this.data.classes.find(c => c.id === this.state(teamId).team.course.id)?.archived }))
    }
    if (collection === "classes") {
      if (!itemId && method === "GET") return this.data.classes.filter(c => c.joined).map(c => ({ ...c, organizer: c.organizer_id === DEMO_TEAM_USER }))
      if (!itemId && method === "POST") {
        const title = value("title", "").trim() || fail("Give the class a title.")
        const room = { id: id(), title, code: "DEMO", organizer_id: DEMO_TEAM_USER, archived: false, joined: true, members: [{ id: DEMO_TEAM_USER, display_name: "Demo Student" }], assignments: [] }
        this.data.classes.push(room); return { id: room.id }
      }
      const room = this.data.classes.find(c => c.id === itemId && c.joined) ?? fail("This demo class does not exist.")
      if (!action && method === "GET") return { ...room, organizer: room.organizer_id === DEMO_TEAM_USER }
      if (action === "openings") return this.data.openings.map(teamId => this.state(teamId, false)).filter(s => s.team.course.id === room.id && !this.data.joined.includes(s.team.id))
        .map(s => ({ team_id: s.team.id, team_name: s.team.name, assignment_title: s.team.assignment.title, summary: "", roles: [], commitment: "", places: s.team.size_limit - s.team.members.length, expires_at: "2099-01-01T00:00:00Z", request: this.data.requests.find(r => r.team_id === s.team.id && r.account_id === DEMO_TEAM_USER && r.status === "pending") ?? null }))
      if (action === "members" && subId === DEMO_TEAM_USER && method === "DELETE" && room.organizer_id !== DEMO_TEAM_USER) { room.joined = false; return {} }
      if (room.organizer_id !== DEMO_TEAM_USER) fail("Only the class organizer can make that change.")
      if (action === "archive" || action === "restore") { room.archived = action === "archive"; return {} }
      if (action === "organizer") { room.organizer_id = value("account_id", ""); return {} }
      if (action === "members" && method === "DELETE") { room.members = room.members.filter(m => m.id !== subId); return {} }
      if (action === "assignments" && method === "POST") {
        const assignment = { ...freshDemoTeams().classes[0].assignments[0], id: id(), course_id: room.id, title: value("title", "") }
        room.assignments.push(assignment); return assignment
      }
      if (action === "codes") return this.code("classes", room.id)
    }
    if (collection === "codes") {
      if (itemId === "redeem") {
        const code = this.data.codes[value("code", "").toUpperCase().replace(/[^A-Z0-9]/g, "")] ?? fail("Use a demo code, such as DEMO0004. Real invite codes are not used in this demo.")
        if (Date.parse(code.expires_at) < Date.now()) fail("This demo code has expired.")
        if (code.scope === "teams") { this.join(code.target); return { team_id: code.target } }
        const room = this.data.classes.find(c => c.id === code.target) ?? fail("This class no longer exists.")
        room.joined = true; return { class_id: room.id }
      }
      if (method === "DELETE") { for (const [code, entry] of Object.entries(this.data.codes)) if (entry.id === itemId) delete this.data.codes[code]; return {} }
    }
    if (collection === "invites") {
      const invite = this.data.invites.find(invite => invite.id === itemId) ?? fail("This demo invitation does not exist.")
      if (invite.invited_user_id !== DEMO_TEAM_USER) fail("This invitation belongs to a fictional classmate.")
      if (action === "accept") { invite.status = "accepted"; return this.join(invite.team_id) }
      if (action === "decline") { invite.status = "declined"; return invite }
    }
    if (collection === "assignments") {
      if (action === "teams") return this.createProject(value("name", ""), itemId)
      if (action === "classmates") return freshDemoTeams().classes[0].members.filter(m => m.id !== DEMO_TEAM_USER).map(m => ({ user_id: m.id, display_name: m.display_name, has_team: false }))
    }
    if (collection === "teams") {
      if (!itemId && method === "POST") return this.createProject(value("name", ""))
      if (action === "join-requests" && method === "POST") {
        const state = this.state(itemId, false)
        if (!this.data.openings.includes(itemId)) fail("This project is not accepting requests.")
        const request = { id: id(), team_id: itemId, team_name: state.team.name, account_id: DEMO_TEAM_USER,
          display_name: "Demo Student", note: value("note", ""), status: "pending" as const, expires_at: "2099-01-01T00:00:00Z" }
        this.data.requests.push(request); this.emit(state, "join_request.created", request, "Requested a place in the local demo"); return request
      }
      const state = this.state(itemId)
      const team = state.team
      if (action === "state") return state
      if (action === "presence" || action === "typing") return { ok: true }
      if (action === "seen") { state.last_seen_seq = Math.min(state.last_seq, Math.max(state.last_seen_seq ?? 0, value("seq", 0))); return { last_seen_seq: state.last_seen_seq } }
      if (action === "risks") return []
      if (action === "activity") return { entries: [...(this.data.activity[itemId] ?? [])].filter(entry => !url.searchParams.get("before") || entry.seq < Number(url.searchParams.get("before"))).reverse(), next_before: null }
      if (action === "contribution") return { members: team.members.map(member => ({ user_id: member.user_id, display_name: member.display_name,
        done_points: state.tasks.filter(t => t.assignee_id === member.user_id && t.status === "done").reduce((sum, t) => sum + t.estimate_points, 0),
        done_tasks: state.tasks.filter(t => t.assignee_id === member.user_id && t.status === "done").length,
        open_points: state.tasks.filter(t => t.assignee_id === member.user_id && t.status !== "done").reduce((sum, t) => sum + t.estimate_points, 0),
        messages: state.messages?.filter(m => m.author_user_id === member.user_id).length ?? 0 })) }
      if (action === "tasks" && method === "POST") return this.createTask(state, body)
      if (action === "milestones" && method === "POST") {
        const milestone = { id: id(), team_id: itemId, title: value("title", ""), due: value<string | null>("due", null), deliverable_key: value<string | null>("deliverable_key", null), completed_at: null }
        state.milestones.push(milestone); this.emit(state, "milestone.created", milestone, `Added milestone: ${milestone.title}`); return milestone
      }
      if (action === "messages" && method === "POST") {
        const content = value("content", "").trim() || fail("Write a message first.")
        if (/^\/(catchup|split|draft|plan|review)\b|@hermes\b/i.test(content)) fail("Live Hermes runs are available in real projects. The demo includes a sample proposal you can try.")
        const options = value<string[] | null>("poll_options", null)
        const message: TeamMessage = { id: id(), team_id: itemId, author_user_id: DEMO_TEAM_USER, kind: options ? "poll" : "text",
          content, metadata: options ? { options, votes: {} } : null, reply_to_id: value<string | null>("reply_to_id", null),
          visible_to_user_id: null, created_at: now(), edited_at: null, deleted: false, reactions: {} }
        state.messages?.push(message); this.emit(state, "message.created", message, "Sent a message in this browser"); return message
      }
      if (action === "decisions" && method === "POST") {
        const message = state.messages?.find(m => m.id === value("message_id", "")) ?? fail("That message does not exist.")
        const decision = { id: id(), team_id: itemId, text: message.content, source_message_id: message.id, pinned_by: DEMO_TEAM_USER, created_at: now() }
        state.decisions.push(decision); this.emit(state, "decision.pinned", decision, "Pinned a decision"); return decision
      }
      if (action === "documents" && method === "POST") {
        const kind = value<TeamDocumentInfo["kind"]>("kind", "custom")
        const docId = id()
        const titles = value<Array<{ key: string; title: string }>>("sections", [{ key: "intro", title: "Introduction" }, { key: "details", title: "Details" }])
        const document: TeamDocumentInfo = { id: docId, team_id: itemId, title: value("title", `${kind.toUpperCase()} document`), kind, created_at: now(),
          sections: titles.map((s, i) => ({ ...s, id: id(), document_id: docId, position: i * 1000, owner_user_id: null,
            content_md: "", status: "empty", lock_user_id: null, lock_expires_at: null, version: 1, meta: {} })) }
        state.documents.push(document); this.emit(state, "document.created", document, `Created document: ${document.title}`); return document
      }
      if (action === "leave") {
        team.members = team.members.filter(m => m.user_id !== DEMO_TEAM_USER)
        this.data.joined = this.data.joined.filter(teamId => teamId !== itemId)
        if (team.lead_user_id === DEMO_TEAM_USER && team.members.length) { team.lead_user_id = team.members[0].user_id; team.members[0].is_lead = true; team.viewer_role = "member" }
        this.emit(state, "member.removed", { user_id: DEMO_TEAM_USER }, "Left the demo project"); return { left: true }
      }
      if (action === "join-requests") { this.lead(state); return this.data.requests.filter(r => r.team_id === itemId) }
      if (action === "invites") {
        const person = this.data.classes.flatMap(c => c.members).find(m => m.id === value("user_id", "")) ?? fail("Choose a fictional demo classmate.")
        if (team.members.some(m => m.user_id === person.id)) fail("This classmate is already in the project.")
        const invite = { id: id(), team_id: itemId, team_name: team.name, assignment_title: team.assignment.title,
          invited_user_id: person.id, invited_by_name: "Demo Student", status: "pending", created_at: now() }
        this.data.invites.push(invite); this.emit(state, "invite.created", invite, `Invited ${person.display_name} in this browser`); return invite
      }
      if (action === "opening" && method === "GET") return { open: this.data.openings.includes(itemId), summary: "", roles: [], commitment: "" }
      this.lead(state)
      if (action === "project-details") {
        if (body.project) team.project = { ...team.project, ...body.project as TeamInfo["project"] }
        if (body.assignment) {
          const a = body.assignment as { title: string; problem: string; objective: string; constraints: string[]; deliverables: string[] }
          team.assignment = { ...team.assignment, title: a.title, deliverables: a.deliverables, brief: { ...team.assignment.brief, problem: a.problem, objective: a.objective, constraints: a.constraints, deliverables: a.deliverables } }
        }
        this.emit(state, "team.updated", team, "Updated the project details"); return team
      }
      if (!action && method === "PATCH") {
        team.name = value("name", team.name); team.size_limit = value("size_limit", team.size_limit)
        this.emit(state, "team.updated", team, "Updated the project settings"); return team
      }
      if (action === "lead") {
        const next = team.members.find(m => m.user_id === value("user_id", "")) ?? fail("Choose a project member.")
        team.lead_user_id = next.user_id; team.viewer_role = next.user_id === DEMO_TEAM_USER ? "lead" : "member"
        team.members.forEach(m => { m.is_lead = m.user_id === next.user_id })
        this.emit(state, "team.updated", team, "Transferred project leadership"); return {}
      }
      if (action === "archive" || action === "restore") {
        this.data.archived = this.data.archived.filter(teamId => teamId !== itemId)
        if (action === "archive") this.data.archived.push(itemId)
        this.emit(state, `team.${action === "archive" ? "archived" : "restored"}`, { id: itemId }, `${action === "archive" ? "Archived" : "Restored"} the project`); return {}
      }
      if (action === "codes") return this.code("teams", itemId)
      if (action === "opening") {
        this.data.openings = this.data.openings.filter(teamId => teamId !== itemId)
        if (method === "PUT") this.data.openings.push(itemId)
        this.emit(state, "opening.updated", {}, "Updated available places"); return {}
      }
    }
    if (collection === "join-requests") {
      const request = this.data.requests.find(r => r.id === itemId) ?? fail("This demo request does not exist.")
      const state = this.state(request.team_id, action !== "cancel")
      if (request.status !== "pending") fail("This request has already been decided.")
      if (action === "cancel") {
        if (request.account_id !== DEMO_TEAM_USER) fail("You can only cancel your own request.")
        request.status = "cancelled"
      } else {
        this.lead(state)
        if (action === "accept") {
          if (state.team.members.length >= state.team.size_limit) fail("This demo project is full.")
          request.status = "accepted"
          state.team.members.push({ user_id: request.account_id, display_name: request.display_name, role_label: "", is_lead: false })
          this.emit(state, "member.joined", { user_id: request.account_id, display_name: request.display_name }, "Accepted a fictional classmate")
        } else if (action === "decline") request.status = "declined"
        else fail("This request action is unavailable in the demo.")
      }
      this.emit(state, "join_request.updated", request, "Updated a demo join request"); return request
    }
    if (collection === "tasks") {
      const { state, item: task } = this.find("tasks", itemId)
      if (method === "DELETE") {
        state.tasks = state.tasks.filter(t => t.id !== itemId); state.tasks.forEach(t => { t.depends_on = t.depends_on.filter(dep => dep !== itemId) })
        this.emit(state, "task.deleted", { id: itemId }, `Deleted task: ${task.title}`); return { id: itemId }
      }
      if (action === "move") { task.status = value("status", task.status); task.position = value<number | null>("position", null) ?? state.tasks.length * 1000 }
      else if (method === "PATCH") {
        for (const key of ["title", "description", "assignee_id", "estimate_points", "due", "depends_on", "milestone_id", "rubric_refs", "rationale"] as const) {
          if (body[key] !== undefined) Object.assign(task, { [key]: body[key] })
        }
      } else fail("This task action is unavailable in the demo.")
      task.updated_at = now(); this.emit(state, "task.updated", task, `Updated task: ${task.title}`); return task
    }
    if (collection === "messages") {
      const { state, item: message } = this.find("messages", itemId)
      if (action === "reactions") {
        const emoji = value("emoji", "👍"); const users = message.reactions[emoji] ?? []
        const on = !users.includes(DEMO_TEAM_USER); message.reactions[emoji] = on ? [...users, DEMO_TEAM_USER] : users.filter(user => user !== DEMO_TEAM_USER)
        const result = { message_id: itemId, user_id: DEMO_TEAM_USER, emoji, on }
        this.emit(state, "reaction.toggled", result, "Reacted to a message"); return result
      }
      if (action === "poll-vote") {
        if (message.kind !== "poll") fail("This message is not a poll.")
        const metadata = message.metadata as { options: string[]; votes: Record<string, number> }
        const option = value("option", -1)
        if (!Number.isInteger(option) || option < 0 || option >= metadata.options.length) fail("Choose a poll option.")
        metadata.votes[DEMO_TEAM_USER] = option
      } else {
        if (message.author_user_id !== DEMO_TEAM_USER) fail("You can only edit your own messages.")
        if (method === "DELETE") { message.content = ""; message.deleted = true; message.metadata = null }
        else if (method === "PATCH") { message.content = value("content", ""); message.edited_at = now() }
        else fail("This message action is unavailable in the demo.")
      }
      this.emit(state, message.deleted ? "message.deleted" : "message.edited", message, "Updated a message"); return message.deleted ? { id: itemId } : message
    }
    if (collection === "decisions" && method === "DELETE") {
      const { state } = this.find("decisions", itemId); state.decisions = state.decisions.filter(d => d.id !== itemId)
      this.emit(state, "decision.removed", { id: itemId }, "Unpinned a decision"); return { id: itemId }
    }
    if (collection === "proposals") {
      const { state, item: proposal } = this.find("proposals", itemId)
      if (["vote", "accept", "reject"].includes(action)) return this.proposal(state, proposal, action, value("vote", "up"))
    }
    if (collection === "documents") {
      const { state, item: document } = this.find("documents", itemId)
      this.lead(state)
      if (action === "sections" && method === "POST") {
        const after = document.sections.findIndex(s => s.id === value("after_section_id", ""))
        const section: DocSectionInfo = { id: id(), document_id: itemId, key: value("key", "section"), title: value("title", "New section"), position: 0,
          owner_user_id: null, content_md: "", status: "empty", lock_user_id: null, lock_expires_at: null, version: 1, meta: {} }
        document.sections.splice(after < 0 ? document.sections.length : after + 1, 0, section)
        document.sections.forEach((s, i) => { s.position = i * 1000 })
        this.emit(state, "document.updated", { document }, "Added a document section"); return section
      }
      if (method === "PATCH") { document.title = value("title", document.title); this.emit(state, "document.updated", { document }, "Renamed a document"); return document }
    }
    if (collection === "sections") {
      const { state, document, section } = this.section(itemId)
      if (action === "move" || method === "DELETE") {
        this.lead(state)
        const index = document.sections.findIndex(s => s.id === itemId)
        if (method === "DELETE") document.sections.splice(index, 1)
        else { const next = index + (value("direction", "up") === "up" ? -1 : 1); if (next >= 0 && next < document.sections.length) [document.sections[index], document.sections[next]] = [document.sections[next], document.sections[index]] }
        document.sections.forEach((s, i) => { s.position = i * 1000 }); this.emit(state, "document.updated", { document }, "Updated the document outline"); return document
      }
      if (action === "content") {
        if (section.owner_user_id && section.owner_user_id !== DEMO_TEAM_USER && state.team.lead_user_id !== DEMO_TEAM_USER) fail("Only the section owner or project leader can edit it.")
        if (value("version", 0) !== section.version) fail("This section changed. Reload it before saving.")
        section.content_md = value("content_md", ""); section.version++; section.status = "draft"
      } else if (action === "lock") { section.lock_user_id = DEMO_TEAM_USER; section.lock_expires_at = new Date(Date.now() + 120_000).toISOString() }
      else if (action === "unlock") {
        if (!section.lock_user_id) return section
        section.lock_user_id = null; section.lock_expires_at = null
      }
      else if (method === "PATCH") {
        this.lead(state); section.title = value("title", section.title); section.key = value("key", section.key); section.owner_user_id = value("owner_user_id", section.owner_user_id)
      } else fail("This document action is unavailable in the demo.")
      this.emit(state, "section.updated", section, `Updated section: ${section.title}`); return section
    }
    return fail("This action is unavailable in the demo. Nothing was sent to a server.")
  }
  private code(scope: "teams" | "classes", target: string) {
    const code = `DEMO${crypto.randomUUID().slice(0, 6).toUpperCase()}`
    const entry = { id: id(), scope, target, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() }
    this.data.codes[code] = entry
    return { id: entry.id, code, expires_at: entry.expires_at }
  }
  readonly transport: TeamTransport = {
    mode: "demo", teamAI: false, projectImport: false,
    request: async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const before = copy(this.data)
      this.pending = []
      try {
        const result = copy(this.route(path, init)) as T
        if (init?.method && init.method !== "GET") this.persist()
        for (const { teamId, event } of this.pending) for (const source of this.sources.get(teamId) ?? []) source.emit(event)
        return result
      } catch (error) { this.data = before; throw error }
      finally { this.pending = [] }
    },
    events: (teamId, after) => {
      this.state(teamId)
      const sources = this.sources.get(teamId) ?? new Set<DemoEvents>()
      this.sources.set(teamId, sources)
      const source = new DemoEvents(() => sources.delete(source)); sources.add(source)
      // Catch up snapshots taken before another sandbox operation completed.
      const recent = this.data.events[teamId]?.filter(event => event.seq > after) ?? []
      queueMicrotask(() => { for (const event of recent) source.emit(event) })
      return source
    },
    raw: async (path) => {
      const url = new URL(path, "https://demo.invalid")
      const match = url.pathname.match(/^\/api\/documents\/([^/]+)\/export$/) ?? fail("This export is unavailable in the demo.")
      const { item: document } = this.find("documents", match[1])
      const markdown = `# ${document.title}\n\n${document.sections.map(s => `## ${s.title}\n\n${s.content_md}`).join("\n\n")}`
      const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
      const format = url.searchParams.get("format")
      if (format === "md") return new Response(markdown, { headers: { "Content-Type": "text/markdown" } })
      if (format === "html") return new Response(`<!doctype html><meta charset="utf-8"><title>${escape(document.title)}</title><style>body{max-width:800px;margin:40px auto;font:16px/1.6 system-ui;padding:24px}pre{white-space:pre-wrap}</style><pre>${escape(markdown)}</pre>`, { headers: { "Content-Type": "text/html" } })
      if (format === "docx") {
        const { default: JSZip } = await import("jszip")
        const zip = new JSZip()
        zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${markdown.split("\n").map(line => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`)
        return new Response(await zip.generateAsync({ type: "arraybuffer" }), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } })
      }
      return fail("Choose Markdown, HTML, or Word for the demo export.")
    },
  }
}

let browserSandbox: DemoTeamSandbox | undefined
export function demoTeamSandbox(): DemoTeamSandbox {
  if (!browserSandbox) {
    let storage: DemoStorage | null = null
    try { if (typeof window !== "undefined") storage = window.localStorage } catch { /* Private browsing. */ }
    browserSandbox = new DemoTeamSandbox(storage)
  }
  return browserSandbox
}
