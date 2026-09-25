import { describe, expect, it } from "vitest"
import { applyEvent, fromSnapshot, isBlocked, progressOf, tasksByStatus, upsertMessage } from "@/lib/team-store"
import type { TeamEvent, TeamMessage, TeamState, TeamTask } from "@/lib/teams-api"

const T0 = "2026-09-20T10:00:00+00:00"

function task(id: string, patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id, team_id: "t", title: id, description: "", status: "todo", assignee_id: null, estimate_points: 1, due: null,
    depends_on: [], milestone_id: null, rubric_refs: [], rationale: "", created_by: "user", position: 1,
    created_at: T0, updated_at: T0, ...patch,
  }
}

function message(id: string, createdAt: string, patch: Partial<TeamMessage> = {}): TeamMessage {
  return {
    id, team_id: "t", author_user_id: "u1", kind: "text", content: id, metadata: null, reply_to_id: null,
    visible_to_user_id: null, created_at: createdAt, edited_at: null, deleted: false, reactions: {}, ...patch,
  }
}

function snapshot(patch: Partial<TeamState> = {}): TeamState {
  return {
    team: {
      id: "t", name: "Team", cover_seed: "abc", lead_user_id: "u1", charter: {}, created_at: T0, viewer_role: "lead",
      assignment: { id: "a", course_id: "c", title: "Project", brief: {}, deadline: null, deliverables: [], rubric: [], team_size_min: 2, team_size_max: 4 },
      course: { id: "c", code: "SWE 363", title: "SE", term: "Fall" },
      members: [{ user_id: "u1", display_name: "Sara Alharbi", role_label: "", is_lead: true }],
    },
    tasks: [], milestones: [], decisions: [], documents: [], messages: [], last_seq: 10, last_seen_seq: 10, ...patch,
  }
}

let seq = 10
function event(type: string, payload: Record<string, unknown>): TeamEvent {
  seq += 1
  return { seq, type, actor_user_id: "u1", payload, created_at: T0 }
}

describe("applyEvent", () => {
  it("ignores events at or before the snapshot cursor", () => {
    const store = fromSnapshot(snapshot())
    const stale = { seq: 10, type: "task.created", actor_user_id: "u1", payload: task("a") as unknown as Record<string, unknown>, created_at: T0 }
    expect(applyEvent(store, stale)).toBe(store)
  })

  it("creates then moves a task and advances the cursor", () => {
    let store = fromSnapshot(snapshot())
    store = applyEvent(store, event("task.created", task("a") as unknown as Record<string, unknown>))
    const moved = event("task.moved", { id: "a", status: "doing", position: 3, from: "todo" })
    store = applyEvent(store, moved)
    expect(store.tasks.a.status).toBe("doing")
    expect(store.tasks.a.position).toBe(3)
    expect(store.lastSeq).toBe(moved.seq)
  })

  it("a REST upsert followed by its own event does not duplicate a message", () => {
    const sent = message("m1", "2026-09-20T11:00:00+00:00")
    let store = upsertMessage(fromSnapshot(snapshot()), sent)
    store = applyEvent(store, event("message.created", sent as unknown as Record<string, unknown>))
    expect(store.messages).toHaveLength(1)
  })

  it("keeps messages in time order", () => {
    let store = fromSnapshot(snapshot())
    store = applyEvent(store, event("message.created", message("late", "2026-09-20T12:00:00+00:00") as unknown as Record<string, unknown>))
    store = applyEvent(store, event("message.created", message("early", "2026-09-20T11:00:00+00:00") as unknown as Record<string, unknown>))
    expect(store.messages?.map((item) => item.id)).toEqual(["early", "late"])
  })

  it("deleting a task removes it from dependents", () => {
    let store = fromSnapshot(snapshot({ tasks: [task("a"), task("b", { depends_on: ["a"] })] }))
    store = applyEvent(store, event("task.deleted", { id: "a", detached_from: ["b"] }))
    expect(store.tasks.a).toBeUndefined()
    expect(store.tasks.b.depends_on).toEqual([])
  })

  it("blanks deleted messages", () => {
    let store = fromSnapshot(snapshot({ messages: [message("m1", T0, { metadata: { options: ["a", "b"] } })] }))
    store = applyEvent(store, event("message.deleted", { id: "m1" }))
    expect(store.messages?.[0]).toMatchObject({ deleted: true, content: "", metadata: null })
  })

  it("applies reaction toggles idempotently", () => {
    let store = fromSnapshot(snapshot({ messages: [message("m1", T0)] }))
    const on = { message_id: "m1", user_id: "u2", emoji: "👍", on: true }
    store = applyEvent(store, event("reaction.toggled", on))
    store = applyEvent(store, event("reaction.toggled", on))
    expect(store.messages?.[0].reactions).toEqual({ "👍": ["u2"] })
    store = applyEvent(store, event("reaction.toggled", { ...on, on: false }))
    expect(store.messages?.[0].reactions).toEqual({})
  })

  it("tracks section locks, unlocks and content", () => {
    const section = { id: "s1", document_id: "d1", key: "1.1", title: "Purpose", position: 0, owner_user_id: null, content_md: "", status: "empty" as const, lock_user_id: null, lock_expires_at: null, version: 0, meta: {} }
    let store = fromSnapshot(snapshot({ documents: [{ id: "d1", team_id: "t", kind: "srs", title: "SRS", created_at: T0, sections: [section] }] }))
    store = applyEvent(store, event("section.locked", { id: "s1", lock_user_id: "u2", lock_expires_at: "2026-09-20T10:01:30+00:00" }))
    expect(store.documents.d1.sections[0].lock_user_id).toBe("u2")
    store = applyEvent(store, event("section.unlocked", { id: "s1" }))
    expect(store.documents.d1.sections[0].lock_user_id).toBeNull()
    store = applyEvent(store, event("section.updated", { ...section, content_md: "Hello", status: "accepted", version: 1 }))
    expect(store.documents.d1.sections[0]).toMatchObject({ content_md: "Hello", version: 1 })
  })

  it("pins and removes decisions", () => {
    let store = fromSnapshot(snapshot())
    store = applyEvent(store, event("decision.pinned", { id: "d", team_id: "t", text: "Use FastAPI", source_message_id: "m", pinned_by: "u1", created_at: T0 }))
    expect(Object.keys(store.decisions)).toEqual(["d"])
    store = applyEvent(store, event("decision.removed", { id: "d" }))
    expect(store.decisions).toEqual({})
  })

  it("adds a joining member once", () => {
    let store = fromSnapshot(snapshot())
    store = applyEvent(store, event("member.joined", { user_id: "u2", display_name: "Ali" }))
    store = applyEvent(store, event("member.joined", { user_id: "u2", display_name: "Ali" }))
    expect(store.team.members.map((member) => member.user_id)).toEqual(["u1", "u2"])
  })

  it("still advances the cursor for unknown events", () => {
    const store = fromSnapshot(snapshot())
    const unknown = event("something.new", {})
    expect(applyEvent(store, unknown).lastSeq).toBe(unknown.seq)
  })

  it("instructor snapshots ignore chat events", () => {
    let store = fromSnapshot(snapshot({ messages: null, last_seen_seq: null }))
    store = applyEvent(store, event("message.created", message("m1", T0) as unknown as Record<string, unknown>))
    expect(store.messages).toBeNull()
  })
})

describe("selectors", () => {
  it("groups tasks by column in position order and computes progress", () => {
    const store = fromSnapshot(snapshot({ tasks: [
      task("b", { position: 2 }), task("a", { position: 1 }),
      task("d", { status: "done", estimate_points: 3 }), task("x", { status: "doing", estimate_points: 2, depends_on: ["b"] }),
    ] }))
    const columns = tasksByStatus(store)
    expect(columns.todo.map((item) => item.id)).toEqual(["a", "b"])
    expect(columns.done.map((item) => item.id)).toEqual(["d"])
    expect(progressOf(store)).toBe(Math.round((100 * 3) / 7))
    expect(isBlocked(store, store.tasks.x)).toBe(true)
    expect(isBlocked(store, store.tasks.a)).toBe(false)
  })
})
