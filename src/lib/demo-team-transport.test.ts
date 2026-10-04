import { afterEach, describe, expect, it, vi } from "vitest"
import { DemoTeamSandbox, demoTeamSandbox } from "./demo-team-transport"
import { DEMO_TEAM_USER, DEMO_TEAMS_STORAGE_KEY, freshDemoTeams } from "./demo-teams-seed"
import { teamClient, type TeamEvent, type TeamState, type TeamTask } from "./teams-api"
import { applyEvent, fromSnapshot } from "./team-store"

const post = (body?: object): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) })
const patch = (body: object): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) })
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const snapshot = (sandbox: DemoTeamSandbox, teamId = "demo-campus") => sandbox.transport.request<TeamState>(`/api/teams/${teamId}/state`)

describe("Group Projects demo isolation", () => {
  afterEach(() => { vi.unstubAllGlobals(); demoTeamSandbox().reset() })

  it("gives separate installations the same rich baseline and never returns shared mutable references", async () => {
    const one = new DemoTeamSandbox(), two = new DemoTeamSandbox()
    expect(await snapshot(one)).toEqual(await snapshot(two))
    const seed = freshDemoTeams()
    expect(Object.values(seed.teams).flatMap(s => s.tasks)).toHaveLength(48)
    expect(Object.values(seed.teams).flatMap(s => s.documents)).toHaveLength(12)
    expect(Object.values(seed.teams).flatMap(s => s.messages ?? [])).toHaveLength(32)
    const state = await snapshot(one)
    state.team.name = "Tampered response"
    state.tasks[0].title = "Tampered task"
    expect(await snapshot(one)).toEqual(await snapshot(two))
    expect(await snapshot(one)).toEqual(seed.teams["demo-campus"])
  })

  it("persists edits only in the provided browser store, leaves the baseline and other browsers untouched, and resets", async () => {
    const local = storage(), other = storage()
    const sandbox = new DemoTeamSandbox(local)
    await sandbox.transport.request("/api/teams/demo-campus", patch({ name: "My local experiment" }))
    await sandbox.transport.request("/api/tasks/demo-campus-task-8/move", post({ status: "done", position: 2000 }))
    await sandbox.transport.request("/api/teams/demo-campus/messages", post({ content: "This is my private demo message" }))
    const edited = await snapshot(sandbox)
    expect(edited.team.name).toBe("My local experiment")
    expect(edited.tasks[8].status).toBe("done")
    expect(edited.messages?.at(-1)?.content).toBe("This is my private demo message")
    expect(await snapshot(new DemoTeamSandbox(local))).toEqual(edited)
    expect(await snapshot(new DemoTeamSandbox(other))).toEqual(freshDemoTeams().teams["demo-campus"])
    sandbox.reset()
    expect(await snapshot(new DemoTeamSandbox(local))).toEqual(freshDemoTeams().teams["demo-campus"])
  })

  it("forces the demo identity into the sandbox even when supplied with a real transport; never fetches or opens a real stream", async () => {
    const fetch = vi.fn(() => { throw new Error("Network must not be used") })
    const events = vi.fn(() => { throw new Error("Network stream must not be used") })
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("EventSource", events)
    const request = vi.fn()
    const client = teamClient(DEMO_TEAM_USER, { mode: "central", teamAI: true, projectImport: true, request, raw: vi.fn(), events })
    expect(client.demo).toBe(true); expect(client.teamAI).toBe(false); expect(client.projectImport).toBe(false)
    expect((await client.home()).teams).toHaveLength(3)
    await client.updateTask("demo-campus-task-8", { title: "Only in this browser" })
    await client.postMessage("demo-campus", { content: "Demo chat" })
    await client.exportDocument("demo-campus-doc-srs", "md", "modern")
    const stream = client.openEvents("demo-campus", 8)
    await Promise.resolve(); stream.close()
    await expect(client.importProject("demo-campus", { text: "An untrusted document" })).rejects.toThrow("unavailable")
    expect(request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(events).not.toHaveBeenCalled()
    expect(client.eventsUrl("demo-campus", 8)).toBe("")
  })

  it("continues locally with blocked storage and recovers from corrupt storage", async () => {
    const blocked = { getItem: () => { throw new Error("Blocked") }, setItem: () => { throw new Error("Blocked") }, removeItem: () => {} }
    const sandbox = new DemoTeamSandbox(blocked)
    await sandbox.transport.request("/api/teams/demo-campus", patch({ name: "In-memory demo" }))
    expect((await snapshot(sandbox)).team.name).toBe("In-memory demo")
    const broken = storage(); broken.setItem(DEMO_TEAMS_STORAGE_KEY, '{"version":1,"teams":{}}')
    expect(await snapshot(new DemoTeamSandbox(broken))).toEqual(freshDemoTeams().teams["demo-campus"])
  })

  it("keeps normal accounts on their original transport", async () => {
    const request = vi.fn().mockResolvedValue({ teams: [] })
    const client = teamClient("real-account", { mode: "central", teamAI: true, projectImport: true, request, raw: vi.fn(), events: vi.fn() })
    await client.home()
    expect(client.demo).toBe(false); expect(client.teamAI).toBe(true)
    expect(request).toHaveBeenCalledWith("/api/me/teams-home", undefined)
  })

  it("delivers local events and catches up the snapshot/stream gap with the production reducer", async () => {
    const sandbox = new DemoTeamSandbox()
    let store = fromSnapshot(await snapshot(sandbox))
    const task = await sandbox.transport.request<TeamTask>("/api/teams/demo-campus/tasks", post({ title: "Created during startup" }))
    const source = sandbox.transport.events("demo-campus", store.lastSeq)
    const opened = vi.fn(); source.onopen = opened
    const fold = (event: Event) => { store = applyEvent(store, JSON.parse((event as MessageEvent).data) as TeamEvent) }
    source.addEventListener("task.created", fold); source.addEventListener("task.updated", fold)
    await Promise.resolve()
    expect(opened).toHaveBeenCalledOnce(); expect(store.tasks[task.id].title).toBe(task.title)
    await sandbox.transport.request(`/api/tasks/${task.id}/move`, post({ status: "review" }))
    expect(store.tasks[task.id].status).toBe("review")
    source.close()
    await sandbox.transport.request(`/api/tasks/${task.id}/move`, post({ status: "done" }))
    expect(store.tasks[task.id].status).toBe("review")
  })

  it("supports local lead edits, sample proposals, document saves, polls, and exports", async () => {
    const sandbox = new DemoTeamSandbox()
    await sandbox.transport.request("/api/teams/demo-campus/project-details", patch({ assignment: { title: "Local assignment", problem: "Local problem", objective: "Local goal", constraints: [], deliverables: ["Local hand-in"] } }))
    expect((await snapshot(sandbox)).team.assignment.title).toBe("Local assignment")
    expect((await snapshot(sandbox)).team.assignment.brief.problem).toBe("Local problem")
    const started = await snapshot(sandbox)
    await sandbox.transport.request("/api/proposals/demo-campus-proposal/accept", post())
    const applied = await snapshot(sandbox)
    expect(applied.tasks).toHaveLength(started.tasks.length + 2)
    expect(applied.tasks.slice(0, 12)).toEqual(started.tasks)
    expect(applied.proposals[0].decided_via).toBe("lead_override")
    await expect(sandbox.transport.request("/api/proposals/demo-campus-proposal/accept", post())).rejects.toThrow("already")
    await sandbox.transport.request("/api/sections/demo-campus-section-0-0/content", { method: "PUT", body: JSON.stringify({ content_md: "Local document draft", version: 1 }) })
    await expect(sandbox.transport.request("/api/sections/demo-campus-section-0-0/content", { method: "PUT", body: JSON.stringify({ content_md: "Stale edit", version: 1 }) })).rejects.toThrow("changed")
    await sandbox.transport.request("/api/messages/demo-campus-poll/poll-vote", post({ option: 1 }))
    expect((await snapshot(sandbox)).messages?.find(m => m.kind === "poll")?.metadata?.votes).toMatchObject({ [DEMO_TEAM_USER]: 1 })
    expect(await (await sandbox.transport.raw("/api/documents/demo-campus-doc-srs/export?format=md")).text()).toContain("Local document draft")
    const html = await (await sandbox.transport.raw("/api/documents/demo-campus-doc-srs/export?format=html")).text()
    expect(html).toContain("<!doctype html>")
    const docx = await sandbox.transport.raw("/api/documents/demo-campus-doc-srs/export?format=docx")
    expect(new Uint8Array(await docx.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]))
  })

  it("preserves lead restrictions and lets a demo student leave or join without changing other copies", async () => {
    const sandbox = new DemoTeamSandbox()
    await expect(sandbox.transport.request("/api/teams/demo-study/project-details", patch({ project: { brief: {}, deliverables: [] } }))).rejects.toThrow("leader")
    await sandbox.transport.request("/api/teams/demo-campus/leave", post())
    await expect(snapshot(sandbox)).rejects.toThrow("not a member")
    await sandbox.transport.request("/api/codes/redeem", post({ code: "DEMO-0004" }))
    expect((await snapshot(sandbox, "demo-library")).team.members.map(m => m.user_id)).toContain(DEMO_TEAM_USER)
    const baseline = freshDemoTeams()
    expect(baseline.teams["demo-campus"].team.lead_user_id).toBe(DEMO_TEAM_USER)
    expect(baseline.joined).not.toContain("demo-library")
    await expect(sandbox.transport.request("/api/codes/redeem", post({ code: "A-REAL-CODE" }))).rejects.toThrow("demo code")
  })
})
