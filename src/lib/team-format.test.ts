import { describe, expect, it } from "vitest"
import { briefingLines, dueLabel, fromDateInput, nextSectionKey, plural, timeAgo, toDateInput } from "@/lib/team-format"
import type { TeamsHomeData } from "@/lib/teams-api"

const NOW = new Date("2026-09-26T12:00:00Z")

describe("dueLabel", () => {
  it("describes today, tomorrow, later and overdue", () => {
    expect(dueLabel(null, NOW)).toBeNull()
    expect(dueLabel("2026-09-26T18:00:00Z", NOW)).toBe("due today")
    expect(dueLabel("2026-09-27T12:00:00Z", NOW)).toBe("due tomorrow")
    expect(dueLabel("2026-10-06T12:00:00Z", NOW)).toBe("due in 10 days")
    expect(dueLabel("2026-09-24T12:00:00Z", NOW)).toBe("2d overdue")
    expect(dueLabel("2026-09-26T11:00:00Z", NOW)).toBe("due today")
  })
})

describe("timeAgo", () => {
  it("rounds to friendly units", () => {
    expect(timeAgo("2026-09-26T11:59:40Z", NOW)).toBe("just now")
    expect(timeAgo("2026-09-26T11:55:00Z", NOW)).toBe("5m ago")
    expect(timeAgo("2026-09-26T09:00:00Z", NOW)).toBe("3h ago")
    expect(timeAgo("2026-09-25T06:00:00Z", NOW)).toBe("yesterday")
    expect(timeAgo("2026-09-22T12:00:00Z", NOW)).toBe("4 days ago")
  })
})

describe("date inputs", () => {
  it("round-trip a calendar date through ISO", () => {
    expect(fromDateInput("")).toBeNull()
    expect(toDateInput(null)).toBe("")
    expect(toDateInput(fromDateInput("2026-10-01"))).toBe("2026-10-01")
  })
})

describe("plural", () => {
  it("adds an s except for one", () => {
    expect(plural(1, "task")).toBe("1 task")
    expect(plural(3, "task")).toBe("3 tasks")
  })
})

function home(patch: Partial<TeamsHomeData>): TeamsHomeData {
  return { user: { id: "u", display_name: "U", role: "student", student_id: "u" }, teams: [], needs_team: [], invites: [], ...patch }
}
const course = { id: "c1", code: "SWE 363", title: "SE", term: "Fall" }

describe("briefingLines", () => {
  it("summarises unread, next task, invites and teamless assignments for students", () => {
    const lines = briefingLines(home({
      teams: [{ id: "t", name: "Team Falcon", cover_seed: "x", course, assignment: { id: "a", title: "Term", deadline: null }, progress: 20,
        next_task: { id: "k", title: "Use cases", estimate_points: 3, status: "doing" }, members: [], unread: 3, viewer_role: "lead", risk: null }],
      invites: [{ id: "i", team_id: "t2", team_name: "B", assignment_title: "ML", invited_user_id: "u", invited_by_name: "Sara", status: "pending", created_at: "" }],
      needs_team: [{ assignment_id: "a2", title: "Applied ML", deadline: null, course: { ...course, code: "CS 485" }, team_size_min: 2, team_size_max: 3, open_classmates: 4 }],
    }))
    expect(lines).toEqual(["3 new messages in Team Falcon", "Next for you: Use cases (Team Falcon)", "1 invite waiting", "CS 485 Applied ML still needs a team"])
  })

  it("says all caught up when there is nothing to do", () => {
    expect(briefingLines(home({}))).toEqual(["You're all caught up."])
  })

  it("gives instructors a course-level line that mentions chat privacy", () => {
    const lines = briefingLines(home({
      user: { id: "i", display_name: "Dr", role: "instructor", student_id: null },
      teams: [{ id: "t", name: "A", cover_seed: "x", course, assignment: { id: "a", title: "T", deadline: null }, progress: 0, next_task: null, members: [], unread: null, viewer_role: "instructor", risk: null }],
    }))
    expect(lines).toEqual(["1 team across 1 course. Team chats stay private to students."])
  })
})

describe("briefingLines risks", () => {
  it("adds one line per team at risk", () => {
    const lines = briefingLines(home({
      teams: [{ id: "t", name: "Team Falcon", cover_seed: "x", course, assignment: { id: "a", title: "Term", deadline: null }, progress: 20,
        next_task: null, members: [], unread: 0, viewer_role: "lead", risk: "“Use cases” has been in Doing for 5 days." }],
    }))
    expect(lines).toEqual(["Team Falcon: “Use cases” has been in Doing for 5 days."])
  })
})

describe("nextSectionKey", () => {
  it("increments the last number and skips keys that are taken", () => {
    expect(nextSectionKey("1.2", ["1", "1.1", "1.2"])).toBe("1.3")
    expect(nextSectionKey("1.1", ["1.1", "1.2", "1.3"])).toBe("1.4")
    expect(nextSectionKey("3", ["1", "2", "3"])).toBe("4")
  })
  it("starts a child for keys without a trailing number and picks a top key with nothing selected", () => {
    expect(nextSectionKey("A", ["A"])).toBe("A.1")
    expect(nextSectionKey(undefined, ["1", "2"])).toBe("3")
  })
})
