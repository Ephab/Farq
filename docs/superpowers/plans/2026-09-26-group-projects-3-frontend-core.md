# Group Projects: Plan 3, Frontend Core, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working **Group Projects** section to the React app, built on Plan 1's API:
- a View-as switcher
- the front page (briefing strip, living cover cards, invites, teams still to be formed)
- the Studio workspace: a rail on the left, a board / timeline / docs / decisions / charter view in the centre, and the team chat docked on the right, or an instructor panel for instructors
- everything kept live through the team event stream

**Architecture:** Pure logic lives in `src/lib/` and is unit-tested with Vitest:
- `teams-api.ts`: the client and types
- `team-store.ts`: the event reducer
- `team-format.ts`, `team-cover.ts`, `team-chat.ts`: helpers

`use-team-stream.ts` loads `/state`, then opens one `EventSource` from `last_seq` and folds events into the store. REST responses are upserted immediately, and the reducer is idempotent, so the later matching event changes nothing. Components live in `src/components/teams/`, styled by `teams.css`, which is scoped under `.fq` and reuses the Coach's tokens from `coach-concept.css`.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind 4, `motion/react`, `lucide-react`, Vitest 5 (new dev dependency), FastAPI (one small endpoint).

**Spec:** `docs/superpowers/specs/2026-09-25-group-projects-design.md` (§10 UI, §6 real-time), building on `docs/superpowers/plans/2026-09-25-group-projects-1-backend-foundation.md`.

### Where this plan sits

- Plan 1 (backend foundation): done on `feat/group-projects-backend`.
- **Plan 3 (this):** frontend core.
- Plan 2 (Hermes as a teammate): after this. It fills in the Hermes command entries this plan shows as "next update", plus proposals, votes, notices and catch-up.
- Plan 4: the signature animations (dealing the cards, ghost tasks, vote card, live cursor, milestone burst, halos with Cmd+K, replay) and the Playwright demo script.

## Global Constraints

- Everything is a new file under `src/components/teams/` or `src/lib/`. The only existing files edited are `src/App.tsx` (the nav item), `package.json` (Vitest) and `services/api/app/teams/teams.py` (the classmates endpoint).
- Team requests send `X-Farq-User: <acting user>`. The stream uses `?as=<acting user>&after=<last_seq>` (`EventSource` can't send headers). The acting user comes from localStorage `farq.current-user`, falling back to the current student id.
- **Instructors never request or render the chat.** For them, `messages` is `null` and the dock renders `InstructorPanel`.
- **The UI never claims Hermes did something it can't yet do.** Hermes slash commands and the "Find teammates" button are visible but disabled, labelled "next update" or "coming soon".
- **Styling:** use the `tm-*` classes in `teams.css`, all under `.fq`. Tailwind utilities only go on elements without a `tm-` class, because `.fq .tm-*` specificity beats utilities. Colours come from `--fq-*` tokens, so every theme works.
- **Accessibility:**
  - every icon-only button has an `aria-label`
  - message and task text uses `dir="auto"` (Arabic)
  - animations honour `prefers-reduced-motion`
  - board cards open with Enter or Space, and the task sheet can change status without dragging
- Verification per task: `npx vitest run` where the task adds tests, `npm run build` (tsc + vite) and `npm run lint` with no errors. Backend: `.venv/Scripts/python -m pytest services/api/tests -q`, with a baseline of **151 passed**.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Deliberate refinement of the spec:** the View-as switcher sits in the Group Projects header, not the sidebar footer. Switching the whole app to a seeded classmate would break Roadmap and Coach for students who have no roadmap, so View-as changes the acting user **for team features only**.

## Review Focus

1. **The gap between the snapshot and the stream opening.** An event written while `/state` is in flight must be neither lost nor applied twice. The stream starts at `after=last_seq`, and `applyEvent` ignores `seq <= lastSeq` and upserts by id. *(Task 2: `ignores events at or before the snapshot cursor`, `a REST upsert followed by its own event does not duplicate a message`)*
2. **Switching View-as while a team is open.** It must close the old `EventSource` and never show the previous user's chat. `TeamsView` keys the workspace by `actingUser:teamId`. *(Task 8 walkthrough step 6)*
3. **An instructor opening a team.** There must be no chat request, no chat UI and no unread badge. *(Task 2: `instructor snapshots ignore chat events`, and Task 8 walkthrough step 7)*
4. **A failed optimistic drag** (for example, a server rejection). The board must return to server truth and show a banner. *(Task 5: `fail()` calls `reload()`, and Task 8 walkthrough step 4)*
5. **Arabic and emoji messages.** They must render right-to-left without breaking the layout. *(Task 1: `initials handles Arabic names`, and Task 8 walkthrough step 5, where the seed includes an Arabic message)*

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/teams-api.ts` | Types matching Plan 1's JSON, acting-user storage, `teams.*` REST client, `eventsUrl` |
| `src/lib/team-format.ts` | `dueLabel`, `shortDate`, `timeAgo`, `toDateInput`/`fromDateInput`, `plural`, `briefingLines` |
| `src/lib/team-cover.ts` | Deterministic cover gradients, avatar colours, initials |
| `src/lib/team-chat.ts` | `mentionQuery`, `insertMention`, `slashQuery`, `parsePoll`, `HERMES_COMMANDS` |
| `src/lib/team-store.ts` | `TeamStore`, `fromSnapshot`, `applyEvent`, upsert helpers, selectors |
| `src/components/teams/use-team-stream.ts` | `useTeamStream`, `usePresence`, `useMarkSeen` |
| `src/components/teams/teams.css` | All Group Projects styles (scoped `.fq`) |
| `src/components/teams/ui.tsx` | `Avatar`, `HermesAvatar`, `Banner`, `Sheet` |
| `src/components/teams/TeamCover.tsx` | Living cover card + progress ring |
| `src/components/teams/TeamsHome.tsx` | Front page (briefing, invites, covers, needs-a-team rows) |
| `src/components/teams/MemberList.tsx` | Rail members with presence + invite picker |
| `src/components/teams/TaskBoard.tsx` | Four-column board with drag and drop |
| `src/components/teams/TaskSheet.tsx` | Create/edit task side sheet |
| `src/components/teams/TaskTimeline.tsx` | Milestones timeline + add milestone |
| `src/components/teams/TeamChat.tsx` | Team chat dock |
| `src/components/teams/DocStudio.tsx` | SRS/SDS/SPMP outline + lock/edit/save |
| `src/components/teams/DecisionLog.tsx` | Pinned decisions |
| `src/components/teams/CharterView.tsx` | Charter, assignment brief, rubric |
| `src/components/teams/InstructorPanel.tsx` | Contribution, milestones, decisions for instructors |
| `src/components/teams/TeamWorkspace.tsx` | Studio layout wiring |
| `src/components/teams/ViewAsSwitcher.tsx` | Demo acting-user select |
| `src/components/teams/TeamsView.tsx` | Section root: home ↔ workspace |

---

### Task 1: Vitest, the API client and pure helpers

**Files:**
- Modify: `package.json` (dev dependency + `test` script)
- Create: `src/lib/teams-api.ts`, `src/lib/team-format.ts`, `src/lib/team-cover.ts`, `src/lib/team-chat.ts`
- Test: `src/lib/team-format.test.ts`, `src/lib/team-cover.test.ts`, `src/lib/team-chat.test.ts`

**Interfaces:**
- Produces (teams-api): every type below; `getActingUserId()`, `setActingUserId(id | null)`, `ACTING_USER_EVENT`, `errorMessage(reason)`, and the `teams` client object with the methods listed in the code.
- Produces (helpers): `dueLabel(iso, now?)`, `shortDate(iso)`, `timeAgo(iso, now?)`, `toDateInput(iso)`, `fromDateInput(value)`, `plural(n, word)`, `briefingLines(home)`, `coverFor(seed) -> {image, color, accents}`, `avatarColor(userId)`, `initials(name)`, `mentionQuery(draft)`, `insertMention(draft, name)`, `slashQuery(draft)`, `parsePoll(text)`, `HERMES_COMMANDS`.

- [ ] **Step 1: Install Vitest and add the script**

Run: `npm install -D vitest@^5.0.2`

In `package.json` `"scripts"`, add `"test": "vitest run"` after `"lint"`.

- [ ] **Step 2: Write the API client (types only need to compile)**

`src/lib/teams-api.ts`:

```ts
import { API_BASE, api, getCurrentStudentId } from "@/lib/farq-api"

const ACTING_USER_STORAGE_KEY = "farq.current-user"
export const ACTING_USER_EVENT = "farq:acting-user-changed"

export type TeamRole = "lead" | "member" | "instructor"
export type TaskStatus = "todo" | "doing" | "review" | "done"
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
  members: string[]; unread: number | null; viewer_role: TeamRole
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
export interface DocSectionInfo {
  id: string; document_id: string; key: string; title: string; position: number; owner_user_id: string | null
  content_md: string; status: "empty" | "draft" | "accepted"; lock_user_id: string | null; lock_expires_at: string | null
  version: number; meta: Record<string, unknown>
}
export interface TeamDocumentInfo { id: string; team_id: string; kind: DocumentKind; title: string; created_at: string; sections: DocSectionInfo[] }
export interface TeamState {
  team: TeamInfo; tasks: TeamTask[]; milestones: TeamMilestone[]; decisions: TeamDecision[]; documents: TeamDocumentInfo[]
  messages: TeamMessage[] | null; last_seq: number; last_seen_seq: number | null
}
export interface TeamEvent { seq: number; type: string; actor_user_id: string | null; payload: Record<string, unknown>; created_at: string | null }
export interface PresenceEntry { user_id: string; focus: string | null; typing: boolean }
export interface ContributionRow { user_id: string; display_name: string; done_points: number; done_tasks: number; open_points: number; messages: number | null }
export interface Classmate { user_id: string; display_name: string; has_team: boolean }

export interface TaskInput {
  title: string; description?: string; assignee_id?: string | null; estimate_points?: number; due?: string | null
  depends_on?: string[]; milestone_id?: string | null; rubric_refs?: string[]; rationale?: string
}
export interface MessageInput { content: string; reply_to_id?: string | null; poll_options?: string[] }
export interface MilestoneInput { title: string; due?: string | null; deliverable_key?: string | null }

/** Who team features act as. Defaults to the signed-in demo student. */
export function getActingUserId(): string {
  if (typeof window === "undefined") return getCurrentStudentId()
  try {
    return window.localStorage.getItem(ACTING_USER_STORAGE_KEY) || getCurrentStudentId()
  } catch {
    return getCurrentStudentId()
  }
}

export function setActingUserId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTING_USER_STORAGE_KEY, id)
    else window.localStorage.removeItem(ACTING_USER_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the event still switches this tab.
  }
  window.dispatchEvent(new Event(ACTING_USER_EVENT))
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong"
}

function teamApi<T>(path: string, init?: RequestInit): Promise<T> {
  return api<T>(path, { ...init, headers: { "X-Farq-User": getActingUserId(), ...(init?.headers as Record<string, string> | undefined) } })
}

function send(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) }
}

export const teams = {
  home: () => teamApi<TeamsHomeData>("/api/me/teams-home"),
  demoUsers: () => api<TeamUser[]>("/api/demo/users"),
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
  vote: (messageId: string, option: number) => teamApi<TeamMessage>(`/api/messages/${messageId}/poll-vote`, send("POST", { option })),
  pin: (teamId: string, messageId: string) => teamApi<TeamDecision>(`/api/teams/${teamId}/decisions`, send("POST", { message_id: messageId })),
  unpin: (decisionId: string) => teamApi<{ id: string }>(`/api/decisions/${decisionId}`, send("DELETE")),
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
    `${API_BASE}/api/teams/${teamId}/events?as=${encodeURIComponent(getActingUserId())}&after=${after}`,
}
```

- [ ] **Step 3: Write the failing helper tests**

`src/lib/team-format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { briefingLines, dueLabel, fromDateInput, plural, timeAgo, toDateInput } from "@/lib/team-format"
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
        next_task: { id: "k", title: "Use cases", estimate_points: 3, status: "doing" }, members: [], unread: 3, viewer_role: "lead" }],
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
      teams: [{ id: "t", name: "A", cover_seed: "x", course, assignment: { id: "a", title: "T", deadline: null }, progress: 0, next_task: null, members: [], unread: null, viewer_role: "instructor" }],
    }))
    expect(lines).toEqual(["1 team across 1 course. Team chats stay private to students."])
  })
})
```

`src/lib/team-cover.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { avatarColor, coverFor, initials } from "@/lib/team-cover"

describe("coverFor", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(coverFor("f41c0n5eed01")).toEqual(coverFor("f41c0n5eed01"))
    expect(coverFor("f41c0n5eed01").image).not.toBe(coverFor("another-seed").image)
    expect(coverFor("").image).toContain("radial-gradient")
    expect(coverFor("x").color).toMatch(/^hsl\(/)
  })
})

describe("avatarColor", () => {
  it("is stable for a user", () => {
    expect(avatarColor("demo-sara")).toBe(avatarColor("demo-sara"))
  })
})

describe("initials", () => {
  it("uses first and last word", () => {
    expect(initials("Sara Alharbi")).toBe("SA")
    expect(initials("noura")).toBe("N")
    expect(initials("   ")).toBe("?")
  })

  it("initials handles Arabic names", () => {
    expect(initials("سارة الحربي")).toBe("سا")
  })
})
```

`src/lib/team-chat.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { insertMention, mentionQuery, parsePoll, slashQuery } from "@/lib/team-chat"

describe("mentions", () => {
  it("finds the partial handle after a trailing @", () => {
    expect(mentionQuery("hey @sa")).toBe("sa")
    expect(mentionQuery("@")).toBe("")
    expect(mentionQuery("mail me at a@b.c")).toBeNull()
    expect(mentionQuery("hello")).toBeNull()
  })

  it("replaces the partial handle with the first name", () => {
    expect(insertMention("thanks @sa", "Sara Alharbi")).toBe("thanks @Sara ")
  })
})

describe("slash commands", () => {
  it("only matches a lone command token", () => {
    expect(slashQuery("/sp")).toBe("sp")
    expect(slashQuery("/")).toBe("")
    expect(slashQuery("/poll When?")).toBeNull()
    expect(slashQuery("hi /x")).toBeNull()
  })
})

describe("parsePoll", () => {
  it("splits question and options on pipes", () => {
    expect(parsePoll("/poll When do we meet? | Sun 8pm | Tue 8pm")).toEqual({ question: "When do we meet?", options: ["Sun 8pm", "Tue 8pm"] })
  })

  it("needs a question and two options", () => {
    expect(parsePoll("/poll Only | one")).toBeNull()
    expect(parsePoll("hello")).toBeNull()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib`
Expected: FAIL. All three files report that `@/lib/team-format`, `@/lib/team-cover` and `@/lib/team-chat` cannot be resolved.

- [ ] **Step 5: Implement the helpers**

`src/lib/team-format.ts`:

```ts
import type { TeamsHomeData } from "@/lib/teams-api"

const DAY = 86_400_000

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

export function dueLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  const days = Math.ceil((time - now.getTime()) / DAY)
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return "due today"
  if (days === 1) return "due tomorrow"
  return `due in ${days} days`
}

export function shortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

/** ISO instant → the local calendar date an `<input type="date">` shows. */
export function toDateInput(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A picked calendar date means "by the end of that day" in the student's time zone. */
export function fromDateInput(value: string): string | null {
  if (!value) return null
  const date = new Date(`${value}T23:59:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Deterministic one-liners for the front-page strip (no model involved). */
export function briefingLines(home: TeamsHomeData): string[] {
  if (home.user.role === "instructor") {
    if (home.teams.length === 0) return ["No teams have formed in your courses yet."]
    const courses = new Set(home.teams.map((team) => team.course.id)).size
    return [`${plural(home.teams.length, "team")} across ${plural(courses, "course")}. Team chats stay private to students.`]
  }
  const lines: string[] = []
  for (const team of home.teams) {
    if (team.unread) lines.push(`${plural(team.unread, "new message")} in ${team.name}`)
  }
  const next = home.teams.find((team) => team.next_task)
  if (next?.next_task) lines.push(`Next for you: ${next.next_task.title} (${next.name})`)
  if (home.invites.length) lines.push(`${plural(home.invites.length, "invite")} waiting`)
  for (const item of home.needs_team) lines.push(`${item.course.code} ${item.title} still needs a team`)
  return lines.length ? lines : ["You're all caught up."]
}
```

`src/lib/team-cover.ts`:

```ts
/** FNV-1a: tiny, stable string hash so every member sees the same cover. */
function hash(seed: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

export interface Cover { image: string; color: string; accents: [string, string, string] }

export function coverFor(seed: string): Cover {
  const h = hash(seed || "farq")
  const base = h % 360
  const second = (base + 40 + ((h >>> 9) % 70)) % 360
  const third = (base + 160 + ((h >>> 17) % 80)) % 360
  const accents: [string, string, string] = [`hsl(${base} 68% 48%)`, `hsl(${second} 78% 62%)`, `hsl(${third} 72% 56%)`]
  const x1 = 8 + ((h >>> 3) % 30)
  const y1 = 10 + ((h >>> 7) % 40)
  const x2 = 62 + ((h >>> 11) % 30)
  const y2 = 50 + ((h >>> 13) % 40)
  return {
    image: `radial-gradient(circle at ${x1}% ${y1}%, ${accents[1]}, transparent 60%), radial-gradient(circle at ${x2}% ${y2}%, ${accents[2]}, transparent 55%)`,
    color: accents[0],
    accents,
  }
}

export function avatarColor(userId: string): string {
  return `hsl(${hash(userId || "?") % 360} 55% 45%)`
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const first = [...words[0]][0]
  if (words.length === 1) return first.toUpperCase()
  return `${first}${[...words[words.length - 1]][0]}`.toUpperCase()
}
```

`src/lib/team-chat.ts`:

```ts
/** Hermes slash commands. Shown now, answered from Plan 2 onwards. */
export const HERMES_COMMANDS = [
  { cmd: "/split", hint: "Split the remaining work fairly" },
  { cmd: "/catchup", hint: "Summarise what you missed" },
  { cmd: "/describe", hint: "Write a task description" },
  { cmd: "/draft", hint: "Draft an SRS, SDS or SPMP section" },
  { cmd: "/standup", hint: "Run an async stand-up" },
  { cmd: "/risks", hint: "Flag deadline risks" },
] as const

/** The partial handle after a trailing "@", or null when not mentioning. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft)
  return match ? match[1] : null
}

export function insertMention(draft: string, name: string): string {
  const handle = name.trim().split(/\s+/)[0] || name
  return draft.replace(/@([^\s@]*)$/, `@${handle} `)
}

/** The partial command while the draft is a single "/word", else null. */
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft)
  return match ? match[1] : null
}

export function parsePoll(text: string): { question: string; options: string[] } | null {
  const match = /^\/poll\s+(.+)$/s.exec(text.trim())
  if (!match) return null
  const parts = match[1].split("|").map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return null
  return { question: parts[0], options: parts.slice(1, 9) }
}
```

- [ ] **Step 6: Run the tests, build and lint**

Run: `npx vitest run src/lib`. Expected: 3 files, 16 tests passed.
Run: `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: `Found 0 errors` (existing warnings allowed).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/teams-api.ts src/lib/team-format.ts src/lib/team-cover.ts src/lib/team-chat.ts src/lib/team-format.test.ts src/lib/team-cover.test.ts src/lib/team-chat.test.ts
git commit -m "feat(teams-ui): add team API client, Vitest and tested format/cover/chat helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The team store reducer

**Files:**
- Create: `src/lib/team-store.ts`
- Test: `src/lib/team-store.test.ts`

**Interfaces:**
- Consumes: the types from `teams-api.ts`.
- Produces: `TeamStore`, `TEAM_EVENT_TYPES`, `TASK_COLUMNS`, `fromSnapshot`, `applyEvent`, `upsertTask`, `removeTask`, `moveTaskLocal`, `upsertMilestone`, `upsertDecision`, `removeDecision`, `upsertDocument`, `upsertSection`, `upsertMessage`, `markMessageDeleted`, `setReaction`, `memberName`, `tasksByStatus`, `progressOf`, `isBlocked`.

- [ ] **Step 1: Write the failing tests**

`src/lib/team-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/team-store.test.ts`
Expected: FAIL. The import of `@/lib/team-store` cannot be resolved.

- [ ] **Step 3: Implement the store**

`src/lib/team-store.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests, build and lint**

Run: `npx vitest run src/lib`. Expected: 4 files, 29 tests passed.
Run: `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: `Found 0 errors`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-store.ts src/lib/team-store.test.ts
git commit -m "feat(teams-ui): add idempotent team event store with selectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Classmates endpoint for the invite picker

**Files:**
- Modify: `services/api/app/teams/teams.py` (add one route after `create_team`)
- Test: `services/api/tests/test_teams_classmates.py`

**Interfaces:**
- Consumes: `_enrollment`, `team_for_assignment`, `require`, `CurrentUser`, `User`, `CourseEnrollment` (all already in `teams.py`).
- Produces: `GET /api/assignments/{assignment_id}/classmates` returns `[{user_id, display_name, has_team}]`, sorted by name, excluding the caller. Any enrolled user may call it; others get 403.

- [ ] **Step 1: Write the failing test**

`services/api/tests/test_teams_classmates.py`:

```python
from team_world import client, hdr, make_world  # noqa: F401


def test_classmates_lists_enrolled_students_with_team_flags(client):
    world = make_world(students=4, team_members=2)
    s0, s1, s2, s3 = world["students"]
    response = client.get(f"/api/assignments/{world['assignment_id']}/classmates", headers=hdr(s0))
    assert response.status_code == 200, response.text
    assert {row["user_id"]: row["has_team"] for row in response.json()} == {s1: True, s2: False, s3: False}


def test_classmates_requires_enrollment(client):
    world = make_world()
    url = f"/api/assignments/{world['assignment_id']}/classmates"
    assert client.get(url, headers=hdr(world["outsider"])).status_code == 403
    assert client.get(url, headers=hdr(world["instructor"])).status_code == 200
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_classmates.py -q`
Expected: FAIL with `assert 404 == 200` / `404 == 403`.

- [ ] **Step 3: Add the route**

In `services/api/app/teams/teams.py`, insert after the `create_team` function:

```python
@router.get("/api/assignments/{assignment_id}/classmates")
def list_classmates(assignment_id: str, db: Db, user: CurrentUser) -> list[dict]:
    assignment = require(db, Assignment, assignment_id, "Assignment")
    if _enrollment(db, assignment.course_id, user.id) is None:
        raise HTTPException(403, "You are not enrolled in this course")
    rows = []
    for enrollment in db.scalars(select(CourseEnrollment).where(
        CourseEnrollment.course_id == assignment.course_id, CourseEnrollment.role == "student", CourseEnrollment.user_id != user.id,
    )).all():
        person = db.get(User, enrollment.user_id)
        rows.append({
            "user_id": enrollment.user_id, "display_name": person.display_name if person else enrollment.user_id,
            "has_team": team_for_assignment(db, assignment.id, enrollment.user_id) is not None,
        })
    return sorted(rows, key=lambda row: row["display_name"].lower())
```

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests -q`
Expected: 153 passed.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/teams/teams.py services/api/tests/test_teams_classmates.py
git commit -m "feat(teams): list classmates with team flags for the invite picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Styles, shared UI and the front page components

**Files:**
- Create: `src/components/teams/teams.css`, `src/components/teams/ui.tsx`, `src/components/teams/TeamCover.tsx`, `src/components/teams/TeamsHome.tsx`

**Interfaces:**
- Consumes: `teams`, `errorMessage`, types (Task 1); `coverFor`, `avatarColor`, `initials`, `dueLabel`, `briefingLines`.
- Produces: `Avatar({userId, name, size?, online?, typing?})`, `HermesAvatar({size?})`, `Banner({message, onDismiss})`, `Sheet({title, onClose, children, footer?})`, `TeamCover({card, onOpen})`, `TeamsHome({onOpenTeam})`.

- [ ] **Step 1: Write the styles**

`src/components/teams/teams.css`:

```css
/* Group Projects. Scoped under .fq so it inherits the coach tokens from
 * src/components/hermes/coach-concept.css and every theme works. */

.fq.tm-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  height: calc(100dvh - 3.5rem);
  overflow: auto;
  padding: clamp(14px, 2.2vw, 28px);
  background: radial-gradient(circle at 80% -10%, var(--fq-accent-soft), transparent 30rem), var(--fq-bg);
}
.fq .tm-topbar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
.fq .tm-title { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.fq .tm-sub, .fq .tm-muted { margin: 2px 0 0; color: var(--fq-muted); font-size: 14px; }
.fq .tm-h2 { margin: 0 0 10px; color: var(--fq-muted); font-size: 12px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; }
.fq .tm-viewas { display: inline-flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; border: 1px solid var(--fq-line); border-radius: var(--fq-r-pill); background: var(--fq-surface); color: var(--fq-muted); font-size: 13px; }
.fq .tm-viewas select { padding: 2px 6px; border: 0; border-radius: var(--fq-r-pill); background: transparent; color: var(--fq-text); font: inherit; font-weight: 600; }

.fq .tm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: var(--fq-r-pill); background: var(--fq-surface-muted); color: var(--fq-text); font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: background 0.15s; }
.fq .tm-btn:hover:not(:disabled) { background: var(--fq-surface-strong); }
.fq .tm-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.fq .tm-btn-primary { background: var(--fq-accent); color: #fff; box-shadow: var(--fq-shadow-accent); }
.fq .tm-btn-primary:hover:not(:disabled) { background: var(--fq-accent-hover); }
.fq .tm-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; }
.fq .tm-icon-btn { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: transparent; color: var(--fq-muted); cursor: pointer; }
.fq .tm-icon-btn:hover, .fq .tm-icon-btn[aria-pressed="true"] { background: var(--fq-surface-muted); color: var(--fq-text); }
.fq .tm-input, .fq .tm-select, .fq .tm-textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--fq-line-strong); border-radius: var(--fq-r-sm); background: var(--fq-surface-solid); color: var(--fq-text); font: inherit; font-size: 14px; }
.fq .tm-textarea { min-height: 90px; line-height: 1.5; resize: vertical; }
.fq .tm-field { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; color: var(--fq-muted); font-size: 12px; font-weight: 600; }
.fq .tm-empty { display: grid; place-items: center; gap: 10px; min-height: 40vh; color: var(--fq-muted); text-align: center; }
.fq .tm-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0; padding: 8px 12px; border-radius: var(--fq-r-sm); background: var(--fq-danger-soft); color: var(--fq-danger); font-size: 13px; }

/* Front page */
.fq .tm-home { display: flex; flex-direction: column; gap: 26px; width: 100%; max-width: 1180px; margin: 0 auto; }
.fq .tm-briefing { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border: 1px solid color-mix(in srgb, var(--fq-accent) 28%, transparent); border-radius: var(--fq-r-md); background: linear-gradient(135deg, var(--fq-accent-soft), rgba(138, 92, 246, 0.08)); font-size: 14px; }
.fq .tm-briefing ul { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; color: var(--fq-text-soft); }
.fq .tm-cover-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.fq .tm-cover { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-height: 184px; padding: 16px; overflow: hidden; border-radius: var(--fq-r-lg); color: #fff; text-align: left; background-size: 160% 160%; background-position: 0% 0%; box-shadow: var(--fq-shadow-sm); cursor: pointer; transition: transform 0.25s var(--fq-ease-out), box-shadow 0.25s, background-position 3s ease; }
.fq .tm-cover:hover { transform: translateY(-3px); background-position: 100% 100%; box-shadow: var(--fq-shadow-lg); }
.fq .tm-cover::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 35%, rgba(8, 12, 24, 0.38)); pointer-events: none; }
.fq .tm-cover > * { position: relative; z-index: 1; }
.fq .tm-cover-chip { padding: 2px 9px; border-radius: var(--fq-r-pill); background: rgba(255, 255, 255, 0.22); font-size: 11px; font-weight: 650; backdrop-filter: blur(6px); }
.fq .tm-cover .tm-cover-unread { position: absolute; top: 14px; right: 14px; padding: 2px 8px; border-radius: var(--fq-r-pill); background: #fff; color: #151a26; font-size: 11px; font-weight: 700; }
.fq .tm-cover-name { margin-top: 10px; font-size: 20px; font-weight: 750; letter-spacing: -0.02em; }
.fq .tm-cover-sub { max-width: 75%; font-size: 12px; opacity: 0.9; }
.fq .tm-cover-members { display: flex; margin-top: 6px; }
.fq .tm-cover-dot { width: 18px; height: 18px; margin-left: -5px; border: 2px solid rgba(255, 255, 255, 0.9); border-radius: 50%; }
.fq .tm-cover-dot:first-child { margin-left: 0; }
.fq .tm-cover-next { max-width: 70%; margin-top: auto; font-size: 12px; font-weight: 600; }
.fq .tm-cover .tm-ring { position: absolute; right: 14px; bottom: 14px; }
.fq .tm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 14px; border: 1px dashed var(--fq-line-strong); border-radius: var(--fq-r-md); background: var(--fq-surface); }
.fq .tm-row + .tm-row { margin-top: 8px; }
.fq .tm-row-swatch { width: 38px; height: 38px; flex: none; border-radius: 12px; }
.fq .tm-row-main { flex: 1; min-width: 200px; }
.fq .tm-row-main strong { display: block; font-size: 14px; }
.fq .tm-row-main span { color: var(--fq-muted); font-size: 12px; }

/* Studio */
.fq .tm-studio { display: grid; flex: 1; grid-template-columns: 220px minmax(0, 1fr) 360px; gap: 14px; min-height: 0; }
@media (max-width: 1180px) { .fq .tm-studio { grid-template-columns: 200px minmax(0, 1fr); } .fq .tm-dock { grid-column: 1 / -1; min-height: 460px; } }
@media (max-width: 760px) { .fq .tm-studio { grid-template-columns: minmax(0, 1fr); } }
.fq .tm-panel { min-height: 0; border: 1px solid var(--fq-line); border-radius: var(--fq-r-lg); background: var(--fq-surface); box-shadow: var(--fq-shadow-sm); backdrop-filter: blur(20px) saturate(140%); }
.fq .tm-rail { display: flex; flex-direction: column; gap: 14px; padding: 12px; overflow: auto; }
.fq .tm-back { display: inline-flex; align-items: center; gap: 6px; background: none; color: var(--fq-muted); font-size: 13px; cursor: pointer; }
.fq .tm-back:hover { color: var(--fq-text); }
.fq .tm-rail-cover { display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: var(--fq-r-md); color: #fff; }
.fq .tm-rail-cover span { font-size: 11px; font-weight: 650; opacity: 0.88; }
.fq .tm-rail-cover strong { font-size: 16px; }
.fq .tm-views { display: flex; flex-direction: column; gap: 2px; }
.fq .tm-view { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 10px; background: none; color: var(--fq-text-soft); font-size: 14px; text-align: left; cursor: pointer; }
.fq .tm-view:hover { background: var(--fq-surface-muted); }
.fq .tm-view[aria-current="page"] { background: var(--fq-text); color: var(--fq-bg); }
.fq .tm-members { display: flex; flex-direction: column; gap: 8px; }
.fq .tm-member { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.fq .tm-member small { display: block; color: var(--fq-muted); font-size: 11px; }
.fq .tm-live { display: flex; align-items: center; gap: 6px; margin: auto 0 0; color: var(--fq-faint); font-size: 11px; }
.fq .tm-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--fq-warning); }
.fq .tm-live[data-live] i { background: var(--fq-success); }
.fq .tm-center { display: flex; flex-direction: column; gap: 12px; padding: 16px; overflow: auto; }
.fq .tm-dock { display: flex; flex-direction: column; overflow: hidden; }

/* Avatars and chips */
.fq .tm-avatar { position: relative; display: inline-grid; place-items: center; flex: none; border-radius: 50%; color: #fff; font-weight: 700; line-height: 1; }
.fq .tm-avatar.is-online::after { content: ""; position: absolute; right: -1px; bottom: -1px; width: 32%; min-width: 7px; height: 32%; min-height: 7px; border-radius: 50%; background: var(--fq-success); box-shadow: 0 0 0 2px var(--fq-surface-solid); }
.fq .tm-avatar.is-typing { box-shadow: 0 0 0 2px var(--fq-accent); }
.fq .tm-hermes { background: linear-gradient(135deg, #315fdf, #8a5cf6); }
.fq .tm-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: var(--fq-r-pill); background: var(--fq-surface-muted); color: var(--fq-text-soft); font-size: 11px; font-weight: 600; }
.fq .tm-chip-warn { background: var(--fq-warning-soft); color: var(--fq-warning); }
.fq .tm-chip-accent { background: var(--fq-accent-soft); color: var(--fq-accent); }

/* Board */
.fq .tm-board-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.fq .tm-columns { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); align-items: start; gap: 10px; overflow-x: auto; }
.fq .tm-col { display: flex; flex-direction: column; gap: 8px; min-height: 220px; padding: 8px; border-radius: var(--fq-r-md); background: var(--fq-surface-muted); transition: background 0.15s, box-shadow 0.15s; }
.fq .tm-col[data-over] { background: var(--fq-accent-soft); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--fq-accent) 45%, transparent); }
.fq .tm-col > header { display: flex; justify-content: space-between; padding: 2px 4px; color: var(--fq-muted); font-size: 12px; font-weight: 650; }
.fq .tm-count { padding: 0 7px; border-radius: var(--fq-r-pill); background: var(--fq-surface-strong); }
.fq .tm-task { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--fq-line); border-radius: var(--fq-r-sm); background: var(--fq-surface-solid); box-shadow: 0 1px 2px rgba(20, 30, 60, 0.05); font-size: 13px; cursor: pointer; }
.fq .tm-task:hover { border-color: var(--fq-line-strong); box-shadow: var(--fq-shadow-sm); }
.fq .tm-task[draggable="true"] { cursor: grab; }
.fq .tm-task[data-dragging] { opacity: 0.45; }
.fq .tm-task-title { font-weight: 600; line-height: 1.35; }
.fq .tm-task-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--fq-muted); font-size: 11px; }

/* Sheet */
.fq .tm-sheet-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: flex-end; background: rgba(10, 14, 24, 0.28); }
.fq .tm-sheet { display: flex; flex-direction: column; width: min(460px, 100%); height: 100%; background: var(--fq-surface-solid); box-shadow: var(--fq-shadow-lg); animation: tm-slide 0.28s var(--fq-ease-out); }
@keyframes tm-slide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
.fq .tm-sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--fq-line); }
.fq .tm-sheet-head h2 { margin: 0; font-size: 16px; }
.fq .tm-sheet-body { display: flex; flex: 1; flex-direction: column; gap: 14px; padding: 16px; overflow: auto; }
.fq .tm-sheet-foot { display: flex; justify-content: space-between; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--fq-line); }
.fq .tm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fq .tm-checks { display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow: auto; color: var(--fq-text); font-size: 13px; font-weight: 500; }
.fq .tm-rationale { margin: 0; padding: 10px 12px; border-radius: var(--fq-r-sm); background: var(--fq-accent-soft); color: var(--fq-text-soft); font-size: 13px; }

/* Timeline */
.fq .tm-timeline { display: flex; flex-direction: column; gap: 18px; margin: 0; padding: 0 0 0 14px; border-left: 2px solid var(--fq-line-strong); list-style: none; }
.fq .tm-ms { position: relative; display: flex; flex-direction: column; gap: 4px; padding-left: 14px; }
.fq .tm-ms::before { content: ""; position: absolute; top: 4px; left: -22px; width: 12px; height: 12px; border: 2px solid var(--fq-accent); border-radius: 50%; background: var(--fq-surface-solid); }
.fq .tm-ms[data-done]::before { border-color: var(--fq-success); background: var(--fq-success); }
.fq .tm-ms[data-final]::before { border-color: var(--fq-danger); background: var(--fq-danger); }
.fq .tm-ms span { color: var(--fq-muted); font-size: 12px; }
.fq .tm-bar { width: min(340px, 100%); height: 6px; overflow: hidden; border-radius: var(--fq-r-pill); background: var(--fq-surface-strong); }
.fq .tm-bar i { display: block; height: 100%; border-radius: inherit; background: var(--fq-accent); transition: width 0.4s var(--fq-ease-out); }
.fq .tm-bar[data-done] i { background: var(--fq-success); }

/* Chat */
.fq .tm-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--fq-line); }
.fq .tm-chat-head strong { font-size: 14px; }
.fq .tm-chat-list { display: flex; flex: 1; flex-direction: column; gap: 4px; padding: 12px; overflow: auto; }
.fq .tm-msg { position: relative; display: flex; gap: 8px; padding: 6px 8px; border-radius: var(--fq-r-sm); }
.fq .tm-msg:hover { background: var(--fq-surface-muted); }
.fq .tm-msg[data-hermes] { background: var(--fq-accent-soft); }
.fq .tm-msg[data-private] { outline: 1px dashed color-mix(in srgb, var(--fq-accent) 45%, transparent); }
.fq .tm-msg-body { flex: 1; min-width: 0; font-size: 14px; }
.fq .tm-msg-body header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; color: var(--fq-muted); font-size: 12px; }
.fq .tm-msg-body header strong { color: var(--fq-text); font-size: 13px; }
.fq .tm-text { margin: 2px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.fq .tm-deleted { margin: 2px 0 0; color: var(--fq-faint); font-style: italic; }
.fq .tm-reply { margin: 4px 0; padding: 4px 8px; border-left: 3px solid var(--fq-line-strong); color: var(--fq-muted); font-size: 12px; }
.fq .tm-system { align-self: center; margin: 6px 0; padding: 3px 12px; border-radius: var(--fq-r-pill); background: var(--fq-success-soft); color: var(--fq-success); font-size: 12px; font-weight: 600; }
.fq .tm-msg-actions { position: absolute; top: -12px; right: 8px; z-index: 2; display: none; gap: 2px; padding: 2px; border: 1px solid var(--fq-line); border-radius: 10px; background: var(--fq-surface-solid); box-shadow: var(--fq-shadow-sm); }
.fq .tm-msg:hover .tm-msg-actions, .fq .tm-msg:focus-within .tm-msg-actions { display: flex; }
.fq .tm-msg-actions button { display: grid; place-items: center; min-width: 26px; height: 26px; border-radius: 8px; background: none; color: var(--fq-muted); font-size: 13px; cursor: pointer; }
.fq .tm-msg-actions button:hover { background: var(--fq-surface-muted); color: var(--fq-text); }
.fq .tm-reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.fq .tm-reaction { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid var(--fq-line); border-radius: var(--fq-r-pill); background: var(--fq-surface-solid); font-size: 12px; cursor: pointer; }
.fq .tm-reaction[aria-pressed="true"] { border-color: var(--fq-accent); background: var(--fq-accent-soft); }
.fq .tm-poll { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.fq .tm-poll-option { position: relative; display: flex; justify-content: space-between; overflow: hidden; padding: 6px 10px; border: 1px solid var(--fq-line-strong); border-radius: 10px; background: var(--fq-surface-solid); font-size: 13px; text-align: left; cursor: pointer; }
.fq .tm-poll-option i { position: absolute; inset: 0 auto 0 0; background: var(--fq-accent-soft); transition: width 0.4s var(--fq-ease-out); }
.fq .tm-poll-option > span { position: relative; }
.fq .tm-poll-option[aria-pressed="true"] { border-color: var(--fq-accent); }
.fq .tm-typing { min-height: 18px; padding: 0 14px; color: var(--fq-muted); font-size: 12px; }
.fq .tm-composer { position: relative; padding: 10px 12px 12px; border-top: 1px solid var(--fq-line); }
.fq .tm-composer-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding: 4px 8px; border-radius: 8px; background: var(--fq-surface-muted); color: var(--fq-muted); font-size: 12px; }
.fq .tm-composer-row { display: flex; align-items: flex-end; gap: 8px; }
.fq .tm-composer textarea { flex: 1; min-height: 40px; max-height: 160px; padding: 9px 12px; border: 1px solid var(--fq-line-strong); border-radius: var(--fq-r-md); background: var(--fq-surface-solid); font-size: 14px; line-height: 1.45; resize: none; }
.fq .tm-suggest { position: absolute; right: 12px; bottom: calc(100% - 4px); left: 12px; z-index: 5; display: flex; flex-direction: column; padding: 4px; border: 1px solid var(--fq-line); border-radius: var(--fq-r-sm); background: var(--fq-surface-solid); box-shadow: var(--fq-shadow-lg); }
.fq .tm-suggest button { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; background: none; font-size: 13px; text-align: left; cursor: pointer; }
.fq .tm-suggest button:hover:not(:disabled) { background: var(--fq-surface-muted); }
.fq .tm-suggest button:disabled { cursor: default; opacity: 0.55; }
.fq .tm-suggest small { margin-left: auto; color: var(--fq-muted); font-size: 11px; }

/* Documents */
.fq .tm-docs { display: grid; flex: 1; grid-template-columns: 260px minmax(0, 1fr); gap: 14px; min-height: 0; }
@media (max-width: 900px) { .fq .tm-docs { grid-template-columns: 1fr; } }
.fq .tm-outline { display: flex; flex-direction: column; gap: 2px; overflow: auto; }
.fq .tm-outline button { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; background: none; color: var(--fq-text-soft); font-size: 13px; text-align: left; cursor: pointer; }
.fq .tm-outline button[data-top] { margin-top: 6px; color: var(--fq-text); font-weight: 700; }
.fq .tm-outline button[aria-current="true"] { background: var(--fq-accent-soft); color: var(--fq-text); }
.fq .tm-status { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--fq-surface-strong); }
.fq .tm-status[data-status="accepted"] { background: var(--fq-success); }
.fq .tm-status[data-status="draft"] { background: var(--fq-warning); }
.fq .tm-section { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.fq .tm-section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.fq .tm-section-head h3 { margin: 0; font-size: 18px; }
.fq .tm-section-body { min-height: 180px; padding: 14px 16px; border: 1px solid var(--fq-line); border-radius: var(--fq-r-md); background: var(--fq-surface-solid); font-size: 14px; line-height: 1.6; }
.fq .tm-doc-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.fq .tm-doc-tabs button { padding: 5px 12px; border-radius: var(--fq-r-pill); background: var(--fq-surface-muted); font-size: 13px; font-weight: 600; cursor: pointer; }
.fq .tm-doc-tabs button[aria-current="true"] { background: var(--fq-text); color: var(--fq-bg); }

/* Lists */
.fq .tm-list { display: flex; flex-direction: column; gap: 10px; }
.fq .tm-card { padding: 12px 14px; border: 1px solid var(--fq-line); border-radius: var(--fq-r-md); background: var(--fq-surface-solid); font-size: 14px; }
.fq .tm-card small { color: var(--fq-muted); font-size: 12px; }
.fq .tm-contrib { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px 10px; font-size: 13px; }

@media (prefers-reduced-motion: reduce) {
  .fq .tm-cover, .fq .tm-sheet, .fq .tm-bar i, .fq .tm-poll-option i { animation: none; transition: none; }
}
```

- [ ] **Step 2: Write the shared UI and the front page**

`src/components/teams/ui.tsx`:

```tsx
"use client"

import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { avatarColor, initials } from "@/lib/team-cover"
import { cn } from "@/lib/utils"

interface AvatarProps { userId: string; name: string; size?: number; online?: boolean; typing?: boolean }

export function Avatar({ userId, name, size = 24, online = false, typing = false }: AvatarProps) {
  return (
    <span
      className={cn("tm-avatar", online && "is-online", typing && "is-typing")}
      style={{ width: size, height: size, background: avatarColor(userId), fontSize: Math.max(9, Math.round(size * 0.4)) }}
      title={name}
      aria-label={name}
      role="img"
    >
      {initials(name)}
    </span>
  )
}

export function HermesAvatar({ size = 24 }: { size?: number }) {
  return (
    <span className="tm-avatar tm-hermes" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-label="Hermes" role="img">
      ✦
    </span>
  )
}

export function Banner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="tm-banner" role="alert">
      <span>{message}</span>
      <button type="button" className="tm-icon-btn" onClick={onDismiss} aria-label="Dismiss"><X className="size-4" /></button>
    </div>
  )
}

interface SheetProps { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }

export function Sheet({ title, onClose, children, footer }: SheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="tm-sheet-backdrop" onClick={onClose}>
      <aside className="tm-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="tm-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="tm-icon-btn" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </header>
        <div className="tm-sheet-body">{children}</div>
        {footer ? <footer className="tm-sheet-foot">{footer}</footer> : null}
      </aside>
    </div>
  )
}
```

`src/components/teams/TeamCover.tsx`:

```tsx
"use client"

import { avatarColor, coverFor } from "@/lib/team-cover"
import { dueLabel } from "@/lib/team-format"
import type { TeamCard } from "@/lib/teams-api"

function ProgressRing({ value }: { value: number }) {
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <svg className="tm-ring" width="44" height="44" viewBox="0 0 44 44" role="img" aria-label={`${clamped}% done`}>
      <circle cx="22" cy="22" r={radius} fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
      <circle
        cx="22" cy="22" r={radius} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} transform="rotate(-90 22 22)"
      />
      <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{clamped}%</text>
    </svg>
  )
}

export function TeamCover({ card, onOpen }: { card: TeamCard; onOpen: () => void }) {
  const cover = coverFor(card.cover_seed)
  const due = dueLabel(card.assignment.deadline)
  return (
    <button type="button" className="tm-cover" style={{ backgroundImage: cover.image, backgroundColor: cover.color }} onClick={onOpen}>
      <span className="tm-cover-chip">{card.course.code}{due ? ` · ${due}` : ""}</span>
      {card.unread ? <span className="tm-cover-unread">{card.unread} new</span> : null}
      <span className="tm-cover-name">{card.name}</span>
      <span className="tm-cover-sub">{card.assignment.title}</span>
      <span className="tm-cover-members" aria-label={`${card.members.length} members`}>
        {card.members.slice(0, 6).map((id) => <span key={id} className="tm-cover-dot" style={{ background: avatarColor(id) }} />)}
      </span>
      {card.next_task ? <span className="tm-cover-next">Next for you: {card.next_task.title}</span> : null}
      <ProgressRing value={card.progress} />
    </button>
  )
}
```

`src/components/teams/TeamsHome.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Sparkles, UserPlus, Users } from "lucide-react"
import { TeamCover } from "@/components/teams/TeamCover"
import { coverFor } from "@/lib/team-cover"
import { briefingLines, dueLabel } from "@/lib/team-format"
import { errorMessage, teams, type NeedsTeam, type TeamInvite, type TeamsHomeData } from "@/lib/teams-api"

export function TeamsHome({ onOpenTeam }: { onOpenTeam: (teamId: string) => void }) {
  const [home, setHome] = useState<TeamsHomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    teams.home().then((data) => { setHome(data); setError(null) }).catch((reason) => setError(errorMessage(reason)))
  }, [])
  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <div className="tm-empty">
        <p>{error}</p>
        <button type="button" className="tm-btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!home) return <div className="tm-empty">Loading your teams…</div>
  const instructor = home.user.role === "instructor"
  return (
    <div className="tm-home">
      <div className="tm-briefing">
        <Sparkles className="size-4 shrink-0 text-[var(--fq-accent)]" aria-hidden="true" />
        <ul>{briefingLines(home).map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
      {home.invites.length > 0 ? (
        <section>
          <h2 className="tm-h2">Invites</h2>
          {home.invites.map((invite) => <InviteRow key={invite.id} invite={invite} onJoined={onOpenTeam} onChanged={load} />)}
        </section>
      ) : null}
      <section>
        <h2 className="tm-h2">{instructor ? "Teams in your courses" : "Your teams"}</h2>
        {home.teams.length > 0 ? (
          <div className="tm-cover-grid">
            {home.teams.map((card) => <TeamCover key={card.id} card={card} onOpen={() => onOpenTeam(card.id)} />)}
          </div>
        ) : (
          <p className="tm-muted">{instructor ? "No teams have formed in your courses yet." : "You're not on a team yet. Create one below."}</p>
        )}
      </section>
      {home.needs_team.length > 0 ? (
        <section>
          <h2 className="tm-h2">Needs a team</h2>
          {home.needs_team.map((item) => <NeedsTeamRow key={item.assignment_id} item={item} onCreated={onOpenTeam} />)}
        </section>
      ) : null}
    </div>
  )
}

interface InviteRowProps { invite: TeamInvite; onJoined: (teamId: string) => void; onChanged: () => void }

function InviteRow({ invite, onJoined, onChanged }: InviteRowProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (accept: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (accept) {
        const team = await teams.acceptInvite(invite.id)
        onJoined(team.id)
      } else {
        await teams.declineInvite(invite.id)
        onChanged()
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tm-row">
      <UserPlus className="size-5 text-[var(--fq-accent)]" aria-hidden="true" />
      <div className="tm-row-main">
        <strong>{invite.invited_by_name} invited you to {invite.team_name}</strong>
        <span>{error ?? invite.assignment_title}</span>
      </div>
      <button type="button" className="tm-btn" disabled={busy} onClick={() => void act(false)}>Decline</button>
      <button type="button" className="tm-btn tm-btn-primary" disabled={busy} onClick={() => void act(true)}>Join team</button>
    </div>
  )
}

function NeedsTeamRow({ item, onCreated }: { item: NeedsTeam; onCreated: (teamId: string) => void }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const due = dueLabel(item.deadline)
  const swatch = coverFor(item.assignment_id)
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const team = await teams.createTeam(item.assignment_id, name.trim())
      onCreated(team.id)
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }
  return (
    <div className="tm-row">
      <span className="tm-row-swatch" style={{ backgroundImage: swatch.image, backgroundColor: swatch.color }} aria-hidden="true" />
      <div className="tm-row-main">
        <strong>{item.course.code} · {item.title}</strong>
        <span>{error ?? `Teams of ${item.team_size_min}–${item.team_size_max}${due ? ` · ${due}` : ""} · ${item.open_classmates} classmates without a team`}</span>
      </div>
      {naming ? (
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <input className="tm-input" style={{ width: 180 }} autoFocus placeholder="Team name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="tm-btn tm-btn-primary" disabled={busy || name.trim().length < 2}>Create</button>
        </form>
      ) : (
        <>
          <button type="button" className="tm-btn" disabled title="Coming soon: Hermes suggests classmates who complement you">
            <Users className="size-4" aria-hidden="true" /> Find teammates
          </button>
          <button type="button" className="tm-btn tm-btn-primary" onClick={() => setNaming(true)}>Create team</button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build and lint**

Run: `npm run build`. Expected: `✓ built`. The components are not wired into the app yet, but they are type-checked.
Run: `npm run lint`. Expected: `Found 0 errors`.

- [ ] **Step 4: Commit**

```bash
git add src/components/teams/teams.css src/components/teams/ui.tsx src/components/teams/TeamCover.tsx src/components/teams/TeamsHome.tsx
git commit -m "feat(teams-ui): add Group Projects styles, shared UI and front page components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stream hook, board, task sheet, timeline and members

**Files:**
- Create: `src/components/teams/use-team-stream.ts`, `src/components/teams/MemberList.tsx`, `src/components/teams/TaskBoard.tsx`, `src/components/teams/TaskSheet.tsx`, `src/components/teams/TaskTimeline.tsx`

**Interfaces:**
- Consumes: `teams`, `errorMessage`, `TEAM_EVENT_TYPES`, `fromSnapshot`, `applyEvent`, store helpers, `Avatar`, `Sheet`.
- Produces:
  - `useTeamStream(teamId) -> { store: TeamStore | null; error: string | null; live: boolean; reload: () => Promise<TeamStore>; update: (fn) => void }`
  - `usePresence(teamId, enabled, focus)`
  - `useMarkSeen(teamId, store | null, update)`
  - `TaskSheetState` (type), plus the components `MemberList`, `TaskBoard`, `TaskSheet` and `TaskTimeline`, with the props shown in the code.

- [ ] **Step 1: Write the stream hook**

`src/components/teams/use-team-stream.ts`:

```ts
import { useCallback, useEffect, useState } from "react"
import { TEAM_EVENT_TYPES, applyEvent, fromSnapshot, type TeamStore } from "@/lib/team-store"
import { errorMessage, teams, type PresenceEntry, type TeamEvent } from "@/lib/teams-api"

export type StoreUpdate = (fn: (store: TeamStore) => TeamStore) => void

/** Snapshot, then one EventSource from its cursor. The browser resends
 * Last-Event-ID on reconnect, and applyEvent drops anything already seen. */
export function useTeamStream(teamId: string) {
  const [store, setStore] = useState<TeamStore | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  const reload = useCallback(async () => {
    const next = fromSnapshot(await teams.state(teamId))
    setStore(next)
    setError(null)
    return next
  }, [teamId])

  useEffect(() => {
    let source: EventSource | null = null
    let cancelled = false
    reload()
      .then((initial) => {
        if (cancelled) return
        source = new EventSource(teams.eventsUrl(teamId, initial.lastSeq))
        const onEvent = (raw: Event) => {
          const event = JSON.parse((raw as MessageEvent<string>).data) as TeamEvent
          setStore((current) => (current ? applyEvent(current, event) : current))
        }
        for (const type of TEAM_EVENT_TYPES) source.addEventListener(type, onEvent)
        source.addEventListener("presence", (raw) => {
          const presence = JSON.parse((raw as MessageEvent<string>).data) as PresenceEntry[]
          setStore((current) => (current ? { ...current, presence } : current))
        })
        source.onopen = () => setLive(true)
        source.onerror = () => setLive(false)
      })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => {
      cancelled = true
      source?.close()
    }
  }, [teamId, reload])

  const update = useCallback<StoreUpdate>((fn) => setStore((current) => (current ? fn(current) : current)), [])
  return { store, error, live, reload, update }
}

/** Tell teammates what this member is looking at, every 20 s while open. */
export function usePresence(teamId: string, enabled: boolean, focus: string | null) {
  useEffect(() => {
    if (!enabled) return
    const send = () => { teams.presence(teamId, focus).catch(() => undefined) }
    send()
    const timer = window.setInterval(send, 20_000)
    return () => window.clearInterval(timer)
  }, [teamId, enabled, focus])
}

/** Advance the member's read pointer shortly after new events arrive. */
export function useMarkSeen(teamId: string, store: TeamStore | null, update: StoreUpdate) {
  const lastSeq = store?.lastSeq ?? 0
  const lastSeen = store?.lastSeenSeq ?? null
  useEffect(() => {
    if (lastSeen === null || lastSeq <= lastSeen) return
    const timer = window.setTimeout(() => {
      teams.markSeen(teamId, lastSeq)
        .then((result) => update((current) => ({ ...current, lastSeenSeq: result.last_seen_seq })))
        .catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [teamId, lastSeq, lastSeen, update])
}
```

- [ ] **Step 2: Write the members rail, board, task sheet and timeline**

`src/components/teams/MemberList.tsx`:

```tsx
"use client"

import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Avatar } from "@/components/teams/ui"
import type { TeamStore } from "@/lib/team-store"
import { teams, type Classmate } from "@/lib/teams-api"

interface MemberListProps { store: TeamStore; canInvite: boolean; onError: (reason: unknown) => void }

export function MemberList({ store, canInvite, onError }: MemberListProps) {
  const [picking, setPicking] = useState(false)
  const [classmates, setClassmates] = useState<Classmate[] | null>(null)
  const [invited, setInvited] = useState<string[]>([])
  const team = store.team
  const online = new Map(store.presence.map((entry) => [entry.user_id, entry]))
  const full = team.members.length >= team.assignment.team_size_max
  const candidates = (classmates ?? []).filter((person) => !team.members.some((member) => member.user_id === person.user_id))

  const open = async () => {
    setPicking(true)
    try {
      setClassmates(await teams.classmates(team.assignment.id))
    } catch (reason) {
      onError(reason)
      setPicking(false)
    }
  }
  const invite = async (userId: string) => {
    try {
      await teams.invite(team.id, userId)
      setInvited((ids) => [...ids, userId])
    } catch (reason) {
      onError(reason)
    }
  }

  return (
    <section className="tm-members">
      <h2 className="tm-h2" style={{ marginBottom: 0 }}>Team · {team.members.length}/{team.assignment.team_size_max}</h2>
      {team.members.map((member) => {
        const entry = online.get(member.user_id)
        return (
          <div key={member.user_id} className="tm-member">
            <Avatar userId={member.user_id} name={member.display_name} size={28} online={Boolean(entry)} typing={Boolean(entry?.typing)} />
            <div className="min-w-0">
              <span className="block truncate">{member.display_name}{member.is_lead ? " · Lead" : ""}</span>
              <small className="truncate">{entry?.typing ? "typing…" : member.role_label || (entry ? "online" : "")}</small>
            </div>
          </div>
        )
      })}
      {canInvite && !full && !picking ? (
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => void open()}>
          <UserPlus className="size-4" aria-hidden="true" /> Invite
        </button>
      ) : null}
      {picking ? (
        <div className="tm-list">
          {classmates === null ? <small className="tm-muted">Loading classmates…</small> : null}
          {classmates !== null && candidates.length === 0 ? <small className="tm-muted">Everyone in this course is on a team.</small> : null}
          {candidates.map((person) => {
            const sent = invited.includes(person.user_id)
            return (
              <div key={person.user_id} className="tm-member">
                <Avatar userId={person.user_id} name={person.display_name} size={24} />
                <span className="min-w-0 flex-1 truncate">{person.display_name}</span>
                <button type="button" className="tm-btn tm-btn-sm" disabled={person.has_team || sent} onClick={() => void invite(person.user_id)}>
                  {person.has_team ? "Has a team" : sent ? "Invited" : "Invite"}
                </button>
              </div>
            )
          })}
          <button type="button" className="tm-back" onClick={() => setPicking(false)}>Done</button>
        </div>
      ) : null}
    </section>
  )
}
```

`src/components/teams/TaskBoard.tsx`:

```tsx
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
```

`src/components/teams/TaskSheet.tsx`:

```tsx
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
```

`src/components/teams/TaskTimeline.tsx`:

```tsx
"use client"

import { useState } from "react"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { dueLabel, fromDateInput, shortDate } from "@/lib/team-format"
import { upsertMilestone, type TeamStore } from "@/lib/team-store"
import { teams } from "@/lib/teams-api"

interface TaskTimelineProps { store: TeamStore; canEdit: boolean; update: StoreUpdate; onError: (reason: unknown) => void }

export function TaskTimeline({ store, canEdit, update, onError }: TaskTimelineProps) {
  const [title, setTitle] = useState("")
  const [due, setDue] = useState("")
  const tasks = Object.values(store.tasks)
  const milestones = Object.values(store.milestones).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
  const deadline = store.team.assignment.deadline
  const dated = tasks
    .filter((task) => !task.milestone_id && task.due && task.status !== "done")
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))

  const add = async () => {
    try {
      const created = await teams.createMilestone(store.team.id, { title: title.trim(), due: fromDateInput(due) })
      update((current) => upsertMilestone(current, created))
      setTitle("")
      setDue("")
    } catch (reason) {
      onError(reason)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="tm-h2" style={{ marginBottom: 0 }}>Timeline</h2>
      <ol className="tm-timeline">
        {milestones.map((milestone) => {
          const own = tasks.filter((task) => task.milestone_id === milestone.id)
          const done = own.filter((task) => task.status === "done").length
          const pct = own.length ? Math.round((100 * done) / own.length) : 0
          return (
            <li key={milestone.id} className="tm-ms" data-done={milestone.completed_at ? "" : undefined}>
              <strong>{milestone.title}</strong>
              <span>
                {milestone.due ? shortDate(milestone.due) : "No date"}
                {milestone.completed_at ? " · complete" : milestone.due ? ` · ${dueLabel(milestone.due)}` : ""}
              </span>
              <div className="tm-bar" data-done={milestone.completed_at ? "" : undefined}><i style={{ width: `${pct}%` }} /></div>
              <span>{done}/{own.length} tasks done</span>
            </li>
          )
        })}
        {deadline ? (
          <li className="tm-ms" data-final="">
            <strong>Final deadline</strong>
            <span>{shortDate(deadline)} · {dueLabel(deadline)}</span>
          </li>
        ) : null}
      </ol>
      {dated.length > 0 ? (
        <section>
          <h2 className="tm-h2">Dated tasks</h2>
          <div className="tm-list">
            {dated.map((task) => (
              <div key={task.id} className="tm-card flex justify-between gap-3">
                <span dir="auto">{task.title}</span>
                <small>{task.due ? shortDate(task.due) : ""}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {canEdit ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void add() }}>
          <label className="tm-field" style={{ minWidth: 220 }}>New milestone
            <input className="tm-input" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="tm-field">Due
            <input type="date" className="tm-input" value={due} onChange={(event) => setDue(event.target.value)} />
          </label>
          <button type="submit" className="tm-btn tm-btn-primary" disabled={!title.trim()}>Add milestone</button>
        </form>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Build and lint**

Run: `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: `Found 0 errors`.

- [ ] **Step 4: Commit**

```bash
git add src/components/teams/use-team-stream.ts src/components/teams/MemberList.tsx src/components/teams/TaskBoard.tsx src/components/teams/TaskSheet.tsx src/components/teams/TaskTimeline.tsx
git commit -m "feat(teams-ui): add live team stream hook, board, task sheet, timeline and members rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Team chat

**Files:**
- Create: `src/components/teams/TeamChat.tsx`

**Interfaces:**
- Consumes: `teams`, `errorMessage`, `getActingUserId`, `mentionQuery`, `insertMention`, `slashQuery`, `parsePoll`, `HERMES_COMMANDS`, `timeAgo`, `memberName`, `upsertMessage`, `upsertDecision`, `markMessageDeleted`, `setReaction`, `MarkdownText`, `Avatar`, `HermesAvatar`.
- Produces: `TeamChat({ store, update, onMakeTask })`.

- [ ] **Step 1: Write the chat**

`src/components/teams/TeamChat.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, CornerUpLeft, ListPlus, Pencil, Pin, Search, Trash2, X } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { Avatar, HermesAvatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { HERMES_COMMANDS, insertMention, mentionQuery, parsePoll, slashQuery } from "@/lib/team-chat"
import { timeAgo } from "@/lib/team-format"
import { markMessageDeleted, memberName, setReaction, upsertDecision, upsertMessage, type TeamStore } from "@/lib/team-store"
import { errorMessage, getActingUserId, teams, type TeamMessage } from "@/lib/teams-api"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"]

interface TeamChatProps { store: TeamStore; update: StoreUpdate; onMakeTask: (title: string) => void }

export function TeamChat({ store, update, onMakeTask }: TeamChatProps) {
  const me = getActingUserId()
  const teamId = store.team.id
  const messages = store.messages ?? []
  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null)
  const [editing, setEditing] = useState<TeamMessage | null>(null)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)

  const needle = query.trim().toLowerCase()
  const visible = needle ? messages.filter((message) => !message.deleted && message.content.toLowerCase().includes(needle)) : messages
  const pinned = new Set(Object.values(store.decisions).map((decision) => decision.source_message_id))
  const typers = store.presence
    .filter((entry) => entry.typing && entry.user_id !== me)
    .map((entry) => memberName(store, entry.user_id).split(" ")[0])
  const mention = mentionQuery(draft)
  const slash = slashQuery(draft)
  const mentionOptions = mention === null ? [] : [
    ...store.team.members.filter((member) => member.user_id !== me).map((member) => ({ id: member.user_id, name: member.display_name, hermes: false })),
    { id: "hermes", name: "Hermes", hermes: true },
  ].filter((option) => option.name.toLowerCase().startsWith(mention.toLowerCase()))
  const commandOptions = slash === null ? [] : [
    { cmd: "/poll", hint: "Question | Option A | Option B", ready: true },
    ...HERMES_COMMANDS.map((command) => ({ cmd: command.cmd as string, hint: command.hint as string, ready: false })),
  ].filter((option) => option.cmd.slice(1).startsWith(slash.toLowerCase()))

  useEffect(() => {
    const list = listRef.current
    if (list && !needle) list.scrollTop = list.scrollHeight
  }, [messages.length, needle])

  const run = async (work: () => Promise<void>) => {
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const onDraftChange = (value: string) => {
    setDraft(value)
    const now = Date.now()
    if (value && now - lastTyping.current > 3000) {
      lastTyping.current = now
      teams.typing(teamId).catch(() => undefined)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    await run(async () => {
      if (editing) {
        const message = await teams.editMessage(editing.id, text)
        update((current) => upsertMessage(current, message))
        setEditing(null)
      } else {
        const poll = parsePoll(text)
        if (text.startsWith("/") && !poll) {
          throw new Error(text.startsWith("/poll")
            ? "Write a poll as /poll Question | Option A | Option B"
            : "Hermes commands arrive in the next update. For now, mention your teammates.")
        }
        const message = await teams.postMessage(teamId, poll
          ? { content: poll.question, poll_options: poll.options }
          : { content: text, reply_to_id: replyTo?.id ?? null })
        update((current) => upsertMessage(current, message))
        setReplyTo(null)
      }
      setDraft("")
    })
    setSending(false)
  }

  const react = (message: TeamMessage, emoji: string) => run(async () => {
    const result = await teams.react(message.id, emoji)
    update((current) => setReaction(current, message.id, me, emoji, result.on))
  })
  const vote = (message: TeamMessage, option: number) => run(async () => {
    const updated = await teams.vote(message.id, option)
    update((current) => upsertMessage(current, updated))
  })
  const pin = (message: TeamMessage) => run(async () => {
    const decision = await teams.pin(teamId, message.id)
    update((current) => upsertDecision(current, decision))
  })
  const remove = (message: TeamMessage) => run(async () => {
    await teams.deleteMessage(message.id)
    update((current) => markMessageDeleted(current, message.id))
  })
  const startEdit = (message: TeamMessage) => {
    setEditing(message)
    setReplyTo(null)
    setDraft(message.content)
    inputRef.current?.focus()
  }
  const startReply = (message: TeamMessage) => {
    setReplyTo(message)
    setEditing(null)
    inputRef.current?.focus()
  }
  const clearContext = () => {
    if (editing) setDraft("")
    setEditing(null)
    setReplyTo(null)
  }

  return (
    <aside className="tm-panel tm-dock" aria-label="Team chat">
      <header className="tm-chat-head">
        <div>
          <strong>Team chat</strong>
          <small className="block text-[11px] text-[var(--fq-muted)]">Private to your team</small>
        </div>
        <button
          type="button"
          className="tm-icon-btn"
          aria-label="Search messages"
          aria-pressed={searching}
          onClick={() => { setSearching((value) => !value); setQuery("") }}
        >
          <Search className="size-4" />
        </button>
      </header>
      {searching ? (
        <div className="px-3 pt-2">
          <input className="tm-input" autoFocus placeholder="Search this chat" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      ) : null}
      <div ref={listRef} className="tm-chat-list">
        {visible.length === 0 ? <p className="tm-muted m-auto">{needle ? "No messages match." : "Say hello to your team."}</p> : null}
        {visible.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            store={store}
            me={me}
            pinned={pinned.has(message.id)}
            onReply={startReply}
            onEdit={startEdit}
            onDelete={(item) => void remove(item)}
            onPin={(item) => void pin(item)}
            onReact={(item, emoji) => void react(item, emoji)}
            onVote={(item, option) => void vote(item, option)}
            onMakeTask={(item) => onMakeTask(item.content.slice(0, 200))}
          />
        ))}
      </div>
      <div className="tm-typing" aria-live="polite">
        {typers.length ? `${typers.join(", ")} ${typers.length === 1 ? "is" : "are"} typing…` : ""}
      </div>
      <div className="tm-composer">
        {mentionOptions.length > 0 ? (
          <div className="tm-suggest" role="listbox" aria-label="Mention">
            {mentionOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => { setDraft((current) => insertMention(current, option.name)); inputRef.current?.focus() }}>
                {option.hermes ? <HermesAvatar size={20} /> : <Avatar userId={option.id} name={option.name} size={20} />}
                {option.name}
                {option.hermes ? <small>replies arrive next update</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {commandOptions.length > 0 ? (
          <div className="tm-suggest" role="listbox" aria-label="Commands">
            {commandOptions.map((option) => (
              <button key={option.cmd} type="button" disabled={!option.ready} onClick={() => { setDraft(`${option.cmd} `); inputRef.current?.focus() }}>
                <strong>{option.cmd}</strong>
                <span className="text-[var(--fq-muted)]">{option.hint}</span>
                {!option.ready ? <small>Hermes · next update</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="tm-composer-bar" role="alert">
            <span>{error}</span>
            <button type="button" className="tm-icon-btn" aria-label="Dismiss" onClick={() => setError(null)}><X className="size-3.5" /></button>
          </div>
        ) : null}
        {replyTo || editing ? (
          <div className="tm-composer-bar">
            <span>{editing ? "Editing your message" : `Replying to ${memberName(store, replyTo?.author_user_id ?? null)}`}</span>
            <button type="button" className="tm-icon-btn" aria-label="Cancel" onClick={clearContext}><X className="size-3.5" /></button>
          </div>
        ) : null}
        <div className="tm-composer-row">
          <textarea
            ref={inputRef}
            dir="auto"
            rows={1}
            value={draft}
            aria-label="Message your team"
            placeholder="Message your team: @ to mention, / for commands"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
              if (event.key === "Escape") clearContext()
            }}
          />
          <button
            type="button"
            className="tm-btn tm-btn-primary"
            style={{ width: 40, padding: 0 }}
            aria-label="Send"
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

interface MessageItemProps {
  message: TeamMessage
  store: TeamStore
  me: string
  pinned: boolean
  onReply: (message: TeamMessage) => void
  onEdit: (message: TeamMessage) => void
  onDelete: (message: TeamMessage) => void
  onPin: (message: TeamMessage) => void
  onReact: (message: TeamMessage, emoji: string) => void
  onVote: (message: TeamMessage, option: number) => void
  onMakeTask: (message: TeamMessage) => void
}

function MessageItem({ message, store, me, pinned, onReply, onEdit, onDelete, onPin, onReact, onVote, onMakeTask }: MessageItemProps) {
  if (message.kind === "system") return <div className="tm-system">{message.content}</div>
  const hermes = message.author_user_id === null
  const mine = message.author_user_id === me
  const author = memberName(store, message.author_user_id)
  const parent = message.reply_to_id ? store.messages?.find((item) => item.id === message.reply_to_id) : undefined
  const reactions = Object.entries(message.reactions)
  return (
    <article className="tm-msg" data-hermes={hermes ? "" : undefined} data-private={message.visible_to_user_id ? "" : undefined}>
      {hermes ? <HermesAvatar size={28} /> : <Avatar userId={message.author_user_id ?? ""} name={author} size={28} />}
      <div className="tm-msg-body">
        <header>
          <strong>{author}</strong>
          <time dateTime={message.created_at}>{timeAgo(message.created_at)}</time>
          {message.edited_at ? <span>· edited</span> : null}
          {message.visible_to_user_id ? <span>· only you</span> : null}
          {pinned ? <span>· <Pin className="inline size-3" aria-label="Pinned as a decision" /></span> : null}
        </header>
        {parent ? (
          <blockquote className="tm-reply" dir="auto">
            {memberName(store, parent.author_user_id)}: {parent.deleted ? "deleted message" : parent.content.slice(0, 140)}
          </blockquote>
        ) : null}
        {message.deleted ? (
          <p className="tm-deleted">Message deleted</p>
        ) : hermes ? (
          <div dir="auto"><MarkdownText text={message.content} /></div>
        ) : (
          <p className="tm-text" dir="auto">{message.content}</p>
        )}
        {message.kind === "poll" && !message.deleted ? <PollView message={message} me={me} onVote={(option) => onVote(message, option)} /> : null}
        {reactions.length > 0 ? (
          <div className="tm-reactions">
            {reactions.map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                className="tm-reaction"
                aria-pressed={users.includes(me)}
                title={users.map((userId) => memberName(store, userId)).join(", ")}
                onClick={() => onReact(message, emoji)}
              >
                {emoji} <span>{users.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!message.deleted ? (
        <div className="tm-msg-actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" aria-label={`React with ${emoji}`} onClick={() => onReact(message, emoji)}>{emoji}</button>
          ))}
          <button type="button" aria-label="Reply" title="Reply" onClick={() => onReply(message)}><CornerUpLeft className="size-3.5" /></button>
          {!pinned && !message.visible_to_user_id ? (
            <button type="button" aria-label="Pin as decision" title="Pin as decision" onClick={() => onPin(message)}><Pin className="size-3.5" /></button>
          ) : null}
          <button type="button" aria-label="Make a task" title="Make a task" onClick={() => onMakeTask(message)}><ListPlus className="size-3.5" /></button>
          {mine ? (
            <>
              <button type="button" aria-label="Edit" title="Edit" onClick={() => onEdit(message)}><Pencil className="size-3.5" /></button>
              <button type="button" aria-label="Delete" title="Delete" onClick={() => onDelete(message)}><Trash2 className="size-3.5" /></button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function PollView({ message, me, onVote }: { message: TeamMessage; me: string; onVote: (option: number) => void }) {
  const metadata = (message.metadata ?? {}) as { options?: string[]; votes?: Record<string, number> }
  const options = metadata.options ?? []
  const votes = Object.values(metadata.votes ?? {})
  const mine = metadata.votes?.[me]
  return (
    <div className="tm-poll">
      {options.map((option, index) => {
        const count = votes.filter((vote) => vote === index).length
        const pct = votes.length ? Math.round((100 * count) / votes.length) : 0
        return (
          <button key={option} type="button" className="tm-poll-option" aria-pressed={mine === index} onClick={() => onVote(index)}>
            <i style={{ width: `${pct}%` }} />
            <span dir="auto">{option}</span>
            <span>{count}</span>
          </button>
        )
      })}
      <small className="tm-muted">{votes.length} {votes.length === 1 ? "vote" : "votes"}</small>
    </div>
  )
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/teams/TeamChat.tsx
git commit -m "feat(teams-ui): add team chat with mentions, polls, reactions, replies and pins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documents, decisions, charter and the instructor panel

**Files:**
- Create: `src/components/teams/DocStudio.tsx`, `src/components/teams/DecisionLog.tsx`, `src/components/teams/CharterView.tsx`, `src/components/teams/InstructorPanel.tsx`

**Interfaces:**
- Consumes: `teams`, `errorMessage`, `getActingUserId`, `upsertDocument`, `upsertSection`, `removeDecision`, `memberName`, `timeAgo`, `MarkdownText`, `Avatar`.
- Produces:
  - `DocStudio({ store, canEdit, update, onFocus })`
  - `DecisionLog({ store, canEdit, update, onError })`
  - `CharterView({ store })`
  - `InstructorPanel({ store })`

- [ ] **Step 1: Write the four components**

`src/components/teams/DocStudio.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { FileText, Lock, PencilLine } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { Avatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { memberName, upsertDocument, upsertSection, type TeamStore } from "@/lib/team-store"
import { errorMessage, getActingUserId, teams, type DocSectionInfo, type DocumentKind } from "@/lib/teams-api"

const DOC_KINDS: { kind: DocumentKind; label: string; full: string }[] = [
  { kind: "srs", label: "SRS", full: "Software Requirements Specification" },
  { kind: "sds", label: "SDS", full: "Software Design Specification" },
  { kind: "spmp", label: "SPMP", full: "Software Project Management Plan" },
]

function lockedByOther(section: DocSectionInfo, me: string): boolean {
  return Boolean(
    section.lock_user_id && section.lock_user_id !== me && section.lock_expires_at && new Date(section.lock_expires_at).getTime() > Date.now(),
  )
}

interface DocStudioProps { store: TeamStore; canEdit: boolean; update: StoreUpdate; onFocus: (focus: string | null) => void }

export function DocStudio({ store, canEdit, update, onFocus }: DocStudioProps) {
  const me = getActingUserId()
  const docs = Object.values(store.documents).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const [docId, setDocId] = useState<string | null>(null)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const doc = (docId ? store.documents[docId] : undefined) ?? docs[0]
  const section = doc?.sections.find((item) => item.id === sectionId) ?? doc?.sections.find((item) => item.key.includes(".")) ?? doc?.sections[0]
  const sectionKey = section?.id ?? null

  useEffect(() => { onFocus(sectionKey ? `section:${sectionKey}` : null) }, [sectionKey, onFocus])

  // Keep the 90 s lock alive while editing; release it when editing ends or the section changes.
  useEffect(() => {
    if (!editing || !sectionKey) return
    const heartbeat = window.setInterval(() => { teams.lockSection(sectionKey).catch(() => undefined) }, 30_000)
    return () => {
      window.clearInterval(heartbeat)
      teams.unlockSection(sectionKey).catch(() => undefined)
    }
  }, [editing, sectionKey])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const create = (kind: DocumentKind) => run(async () => {
    const created = await teams.createDocument(store.team.id, kind)
    update((current) => upsertDocument(current, created))
    setDocId(created.id)
    setSectionId(null)
  })
  const startEdit = (target: DocSectionInfo) => run(async () => {
    const locked = await teams.lockSection(target.id)
    update((current) => upsertSection(current, locked))
    setText(locked.content_md)
    setVersion(locked.version)
    setEditing(true)
  })
  const save = (target: DocSectionInfo) => run(async () => {
    const saved = await teams.saveSection(target.id, text, version)
    update((current) => upsertSection(current, saved))
    setEditing(false)
  })
  const setOwner = (target: DocSectionInfo, ownerId: string) => run(async () => {
    const saved = await teams.updateSection(target.id, { owner_user_id: ownerId || null })
    update((current) => upsertSection(current, saved))
  })
  const select = (id: string) => {
    setEditing(false)
    setSectionId(id)
  }

  const expected = new Set(store.team.assignment.deliverables)
  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="tm-h2" style={{ marginBottom: 0 }}>Documents</h2>
        <p className="tm-muted">Start a deliverable. Each one gets the standard IEEE outline, and every section can have an owner.</p>
        {error ? <p className="tm-banner">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {DOC_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={expected.has(item.kind) ? "tm-btn tm-btn-primary" : "tm-btn"}
              disabled={!canEdit || busy}
              onClick={() => void create(item.kind)}
            >
              <FileText className="size-4" aria-hidden="true" /> {item.full}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const missing = DOC_KINDS.filter((item) => !docs.some((existing) => existing.kind === item.kind))
  const blocked = section ? lockedByOther(section, me) : false
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="tm-board-head">
        <div className="tm-doc-tabs">
          {docs.map((item) => (
            <button key={item.id} type="button" aria-current={item.id === doc.id} onClick={() => { setDocId(item.id); setSectionId(null); setEditing(false) }}>
              {DOC_KINDS.find((kind) => kind.kind === item.kind)?.label ?? item.title}
            </button>
          ))}
        </div>
        {canEdit && missing.length > 0 ? (
          <select
            className="tm-select"
            style={{ width: "auto" }}
            aria-label="New document"
            value=""
            disabled={busy}
            onChange={(event) => { if (event.target.value) void create(event.target.value as DocumentKind) }}
          >
            <option value="">+ New document</option>
            {missing.map((item) => <option key={item.kind} value={item.kind}>{item.full}</option>)}
          </select>
        ) : null}
      </div>
      {error ? <p className="tm-banner">{error}</p> : null}
      <div className="tm-docs">
        <nav className="tm-outline" aria-label={`${doc.title} outline`}>
          {doc.sections.map((item) => (
            <button
              key={item.id}
              type="button"
              data-top={item.key.includes(".") ? undefined : ""}
              aria-current={item.id === section?.id}
              onClick={() => select(item.id)}
            >
              <span className="tm-status" data-status={item.status} aria-label={item.status} role="img" />
              <span className="min-w-0 flex-1 truncate">{item.key} {item.title}</span>
              {lockedByOther(item, me) ? <Lock className="size-3" aria-label="Being edited" /> : null}
              {item.owner_user_id ? <Avatar userId={item.owner_user_id} name={memberName(store, item.owner_user_id)} size={18} /> : null}
            </button>
          ))}
        </nav>
        {section ? (
          <section className="tm-section">
            <div className="tm-section-head">
              <h3>{section.key} {section.title}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="tm-select"
                  style={{ width: "auto" }}
                  aria-label="Section owner"
                  value={section.owner_user_id ?? ""}
                  disabled={!canEdit || busy}
                  onChange={(event) => void setOwner(section, event.target.value)}
                >
                  <option value="">No owner</option>
                  {store.team.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
                </select>
                {canEdit && editing ? (
                  <>
                    <button type="button" className="tm-btn" onClick={() => setEditing(false)}>Cancel</button>
                    <button type="button" className="tm-btn tm-btn-primary" disabled={busy} onClick={() => void save(section)}>Save</button>
                  </>
                ) : null}
                {canEdit && !editing ? (
                  <button type="button" className="tm-btn" disabled={busy || blocked} onClick={() => void startEdit(section)}>
                    <PencilLine className="size-4" aria-hidden="true" /> Edit
                  </button>
                ) : null}
              </div>
            </div>
            {blocked ? (
              <p className="tm-muted"><Lock className="mr-1 inline size-3.5" aria-hidden="true" />{memberName(store, section.lock_user_id)} is editing this section.</p>
            ) : null}
            {editing ? (
              <textarea className="tm-textarea" style={{ minHeight: 320 }} dir="auto" autoFocus value={text} onChange={(event) => setText(event.target.value)} />
            ) : (
              <div className="tm-section-body" dir="auto">
                {section.content_md.trim() ? <MarkdownText text={section.content_md} /> : <p className="tm-muted">Nobody has written this section yet.</p>}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}
```

`src/components/teams/DecisionLog.tsx`:

```tsx
"use client"

import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { timeAgo } from "@/lib/team-format"
import { memberName, removeDecision, type TeamStore } from "@/lib/team-store"
import { teams } from "@/lib/teams-api"

interface DecisionLogProps { store: TeamStore; canEdit: boolean; update: StoreUpdate; onError: (reason: unknown) => void }

export function DecisionLog({ store, canEdit, update, onError }: DecisionLogProps) {
  const decisions = Object.values(store.decisions).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const unpin = async (decisionId: string) => {
    try {
      await teams.unpin(decisionId)
      update((current) => removeDecision(current, decisionId))
    } catch (reason) {
      onError(reason)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="tm-h2" style={{ marginBottom: 0 }}>Decisions</h2>
      {decisions.length === 0 ? (
        <p className="tm-muted">No decisions yet. Pin a chat message to record one. Instructors can see pinned decisions, never the chat.</p>
      ) : (
        <div className="tm-list">
          {decisions.map((decision) => (
            <div key={decision.id} className="tm-card flex items-start justify-between gap-3">
              <div>
                <p className="m-0" dir="auto">{decision.text}</p>
                <small>Pinned by {memberName(store, decision.pinned_by)} · {timeAgo(decision.created_at)}</small>
              </div>
              {canEdit ? <button type="button" className="tm-btn tm-btn-sm" onClick={() => void unpin(decision.id)}>Unpin</button> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

`src/components/teams/CharterView.tsx`:

```tsx
"use client"

import { Avatar } from "@/components/teams/ui"
import { memberName, type TeamStore } from "@/lib/team-store"

export function CharterView({ store }: { store: TeamStore }) {
  const { charter, assignment } = store.team
  const brief = assignment.brief as { problem?: string; objective?: string; deliverables?: string[]; constraints?: string[] }
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="tm-h2">Charter</h2>
        {charter.goal ? (
          <div className="tm-card flex flex-col gap-1">
            <p className="m-0 font-semibold" dir="auto">{charter.goal}</p>
            {charter.meetings ? <small>Meetings: {charter.meetings}</small> : null}
          </div>
        ) : <p className="tm-muted">No charter yet.</p>}
        {charter.roles ? (
          <div className="tm-list mt-3">
            {Object.entries(charter.roles).map(([userId, role]) => (
              <div key={userId} className="tm-member">
                <Avatar userId={userId} name={memberName(store, userId)} size={24} />
                <span>{memberName(store, userId)}</span>
                <small className="ml-auto">{role}</small>
              </div>
            ))}
          </div>
        ) : null}
        {charter.working_agreement?.length ? (
          <ul className="mt-3 list-disc pl-5 text-sm">{charter.working_agreement.map((item) => <li key={item} dir="auto">{item}</li>)}</ul>
        ) : null}
      </section>
      <section>
        <h2 className="tm-h2">Assignment brief</h2>
        <div className="tm-card flex flex-col gap-2">
          <strong>{assignment.title}</strong>
          {brief.problem ? <p className="m-0">{brief.problem}</p> : null}
          {brief.objective ? <p className="m-0 text-[var(--fq-muted)]">{brief.objective}</p> : null}
          {brief.deliverables?.length ? <ul className="m-0 list-disc pl-5 text-sm">{brief.deliverables.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          {brief.constraints?.length ? <small>Constraints: {brief.constraints.join(" · ")}</small> : null}
        </div>
      </section>
      {assignment.rubric.length > 0 ? (
        <section>
          <h2 className="tm-h2">Rubric</h2>
          <div className="tm-list">
            {assignment.rubric.map((criterion) => (
              <div key={criterion.id} className="tm-card flex items-start justify-between gap-3">
                <div>
                  <strong>{criterion.title}</strong>
                  <small className="block">{criterion.description}</small>
                </div>
                <span className="tm-chip">{criterion.weight}%</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
```

`src/components/teams/InstructorPanel.tsx`:

```tsx
"use client"

import { Fragment, useEffect, useState } from "react"
import { Avatar } from "@/components/teams/ui"
import { timeAgo } from "@/lib/team-format"
import type { TeamStore } from "@/lib/team-store"
import { errorMessage, teams, type ContributionRow } from "@/lib/teams-api"

export function InstructorPanel({ store }: { store: TeamStore }) {
  const [rows, setRows] = useState<ContributionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const teamId = store.team.id
  const seq = store.lastSeq

  useEffect(() => {
    let cancelled = false
    teams.contribution(teamId)
      .then((result) => { if (!cancelled) setRows(result.members) })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [teamId, seq])

  const maxPoints = Math.max(1, ...(rows ?? []).map((row) => row.done_points + row.open_points))
  const milestones = Object.values(store.milestones)
  const completed = milestones.filter((milestone) => milestone.completed_at).length
  const decisions = Object.values(store.decisions).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3)

  return (
    <aside className="tm-panel tm-dock" aria-label="Instructor view">
      <header className="tm-chat-head">
        <div>
          <strong>Instructor view</strong>
          <small className="block text-[11px] text-[var(--fq-muted)]">The team chat is private to students</small>
        </div>
      </header>
      <div className="flex flex-col gap-5 overflow-auto p-4">
        <section>
          <h2 className="tm-h2">Contribution</h2>
          {error ? <p className="tm-banner">{error}</p> : null}
          {!error && rows === null ? <p className="tm-muted">Loading…</p> : null}
          {rows ? (
            <div className="tm-contrib">
              {rows.map((row) => (
                <Fragment key={row.user_id}>
                  <Avatar userId={row.user_id} name={row.display_name} size={24} />
                  <div className="min-w-0">
                    <span className="block truncate">{row.display_name}</span>
                    <div className="tm-bar" style={{ width: "100%" }}><i style={{ width: `${(100 * row.done_points) / maxPoints}%` }} /></div>
                  </div>
                  <small>{row.done_points}/{row.done_points + row.open_points} pts</small>
                </Fragment>
              ))}
            </div>
          ) : null}
        </section>
        <section>
          <h2 className="tm-h2">Milestones</h2>
          <p className="m-0 text-sm">{completed} of {milestones.length} complete</p>
        </section>
        <section>
          <h2 className="tm-h2">Latest decisions</h2>
          {decisions.length === 0 ? <p className="tm-muted">None yet.</p> : (
            <div className="tm-list">
              {decisions.map((decision) => (
                <div key={decision.id} className="tm-card">
                  <p className="m-0" dir="auto">{decision.text}</p>
                  <small>{timeAgo(decision.created_at)}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/teams/DocStudio.tsx src/components/teams/DecisionLog.tsx src/components/teams/CharterView.tsx src/components/teams/InstructorPanel.tsx
git commit -m "feat(teams-ui): add document studio, decision log, charter view and instructor panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Workspace, section root, navigation and live walkthrough

**Files:**
- Create: `src/components/teams/TeamWorkspace.tsx`, `src/components/teams/ViewAsSwitcher.tsx`, `src/components/teams/TeamsView.tsx`, `.claude/launch.json`
- Modify: `src/App.tsx` (lucide import line 3; component imports; one nav item after "Projects"; one render branch)

**Interfaces:**
- Consumes: everything above.
- Produces: `TeamsView()`, which is rendered when the sidebar item "Group Projects" is active.

- [ ] **Step 1: Write the workspace, switcher and section root**

`src/components/teams/TeamWorkspace.tsx`:

```tsx
"use client"

import { useState } from "react"
import { ArrowLeft, CalendarRange, FileText, Gavel, LayoutGrid, ScrollText, type LucideIcon } from "lucide-react"
import { CharterView } from "@/components/teams/CharterView"
import { DecisionLog } from "@/components/teams/DecisionLog"
import { DocStudio } from "@/components/teams/DocStudio"
import { InstructorPanel } from "@/components/teams/InstructorPanel"
import { MemberList } from "@/components/teams/MemberList"
import { TaskBoard } from "@/components/teams/TaskBoard"
import { TaskSheet, type TaskSheetState } from "@/components/teams/TaskSheet"
import { TaskTimeline } from "@/components/teams/TaskTimeline"
import { TeamChat } from "@/components/teams/TeamChat"
import { Banner } from "@/components/teams/ui"
import { useMarkSeen, usePresence, useTeamStream } from "@/components/teams/use-team-stream"
import { coverFor } from "@/lib/team-cover"
import { errorMessage } from "@/lib/teams-api"

type View = "board" | "timeline" | "docs" | "decisions" | "charter"

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "timeline", label: "Timeline", icon: CalendarRange },
  { id: "docs", label: "Docs", icon: FileText },
  { id: "decisions", label: "Decisions", icon: Gavel },
  { id: "charter", label: "Charter & brief", icon: ScrollText },
]

export function TeamWorkspace({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { store, error, live, reload, update } = useTeamStream(teamId)
  const [view, setView] = useState<View>("board")
  const [focus, setFocus] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheet, setSheet] = useState<TaskSheetState | null>(null)
  const role = store?.team.viewer_role
  const member = role === "lead" || role === "member"
  usePresence(teamId, member, focus)
  useMarkSeen(teamId, member ? store : null, update)

  if (error) {
    return (
      <div className="tm-empty">
        <p>{error}</p>
        <button type="button" className="tm-btn" onClick={onBack}>Back to all teams</button>
      </div>
    )
  }
  if (!store) return <div className="tm-empty">Opening the team…</div>

  // Any failed write: say why, then return to server truth (undoes optimistic moves).
  const fail = (reason: unknown) => {
    setNotice(errorMessage(reason))
    reload().catch(() => undefined)
  }
  const cover = coverFor(store.team.cover_seed)

  return (
    <div className="tm-studio">
      <aside className="tm-panel tm-rail" aria-label="Team navigation">
        <button type="button" className="tm-back" onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" /> All teams</button>
        <div className="tm-rail-cover" style={{ backgroundImage: cover.image, backgroundColor: cover.color }}>
          <span>{store.team.course.code} · {store.team.assignment.title}</span>
          <strong>{store.team.name}</strong>
        </div>
        <nav className="tm-views" aria-label="Team views">
          {VIEWS.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" className="tm-view" aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
                <Icon className="size-4" aria-hidden="true" /> {item.label}
              </button>
            )
          })}
        </nav>
        <MemberList store={store} canInvite={member} onError={fail} />
        <p className="tm-live" data-live={live ? "" : undefined}><i aria-hidden="true" />{live ? "Live" : "Connecting…"}</p>
      </aside>
      <main className="tm-panel tm-center">
        {notice ? <Banner message={notice} onDismiss={() => setNotice(null)} /> : null}
        {view === "board" ? (
          <TaskBoard
            store={store}
            canEdit={member}
            update={update}
            onError={fail}
            onOpenTask={(task) => { setFocus(`task:${task.id}`); setSheet({ mode: "edit", task }) }}
            onNewTask={() => setSheet({ mode: "create" })}
          />
        ) : view === "timeline" ? (
          <TaskTimeline store={store} canEdit={member} update={update} onError={fail} />
        ) : view === "docs" ? (
          <DocStudio store={store} canEdit={member} update={update} onFocus={setFocus} />
        ) : view === "decisions" ? (
          <DecisionLog store={store} canEdit={member} update={update} onError={fail} />
        ) : (
          <CharterView store={store} />
        )}
      </main>
      {member ? (
        <TeamChat store={store} update={update} onMakeTask={(title) => setSheet({ mode: "create", title })} />
      ) : (
        <InstructorPanel store={store} />
      )}
      {sheet ? (
        <TaskSheet state={sheet} store={store} canEdit={member} update={update} onError={fail} onClose={() => { setSheet(null); setFocus(null) }} />
      ) : null}
    </div>
  )
}
```

`src/components/teams/ViewAsSwitcher.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { setActingUserId, teams, type TeamUser } from "@/lib/teams-api"

/** Demo-only identity switch for team features; Microsoft sign-in replaces it. */
export function ViewAsSwitcher({ value }: { value: string }) {
  const [users, setUsers] = useState<TeamUser[]>([])
  useEffect(() => {
    teams.demoUsers().then(setUsers).catch(() => setUsers([]))
  }, [])
  if (users.length === 0) return null
  const known = users.some((user) => user.id === value)
  return (
    <label className="tm-viewas">
      <span>Viewing as</span>
      <select value={value} onChange={(event) => setActingUserId(event.target.value)}>
        {!known ? <option value={value}>{value}</option> : null}
        {users.map((user) => (
          <option key={user.id} value={user.id}>{user.display_name}{user.role === "instructor" ? " (instructor)" : ""}</option>
        ))}
      </select>
    </label>
  )
}
```

`src/components/teams/TeamsView.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { TeamWorkspace } from "@/components/teams/TeamWorkspace"
import { TeamsHome } from "@/components/teams/TeamsHome"
import { ViewAsSwitcher } from "@/components/teams/ViewAsSwitcher"
import { ACTING_USER_EVENT, getActingUserId } from "@/lib/teams-api"
import "@/components/hermes/coach-concept.css"
import "./teams.css"

export function TeamsView() {
  const [actingUser, setActingUser] = useState(getActingUserId)
  const [teamId, setTeamId] = useState<string | null>(null)

  useEffect(() => {
    const onChange = () => {
      setActingUser(getActingUserId())
      setTeamId(null)
    }
    window.addEventListener(ACTING_USER_EVENT, onChange)
    return () => window.removeEventListener(ACTING_USER_EVENT, onChange)
  }, [])

  return (
    <div className="fq tm-page">
      <div className="tm-topbar">
        <div>
          <h1 className="tm-title">Group Projects</h1>
          <p className="tm-sub">Your course teams: tasks, chat and documents in one place.</p>
        </div>
        <ViewAsSwitcher value={actingUser} />
      </div>
      {teamId ? (
        <TeamWorkspace key={`${actingUser}:${teamId}`} teamId={teamId} onBack={() => setTeamId(null)} />
      ) : (
        <TeamsHome key={actingUser} onOpenTeam={setTeamId} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire the section into `src/App.tsx`**

- Change line 3's lucide import to also import `Users`: `import { Bot, Command, Database, FolderKanban, Home, ListChecks, PanelLeft, Presentation, Route, Users } from "lucide-react"`.
- Add `import { TeamsView } from "@/components/teams/TeamsView"` after the `ProjectsView` import.
- Insert after the closing `</AnimatedSidebarMenuItem>` of the "Projects" item:

```tsx
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<Users className="size-4" />}
                        isActive={active === "Group Projects"}
                        onSelect={() => setActive("Group Projects")}
                        className="text-[15px]"
                      >
                        Group Projects
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
```

- In the `<main>` ternary chain, insert before `) : active === "Projects" ? (`:

```tsx
              ) : active === "Group Projects" ? (
                <TeamsView />
```

- [ ] **Step 3: Build, lint and unit tests**

Run: `npm run build`. Expected: `✓ built`.
Run: `npm run lint`. Expected: `Found 0 errors`.
Run: `npx vitest run`. Expected: 4 files, 29 tests passed.

- [ ] **Step 4: Add launch configs and run the live walkthrough**

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "farq-api",
      "runtimeExecutable": ".venv/Scripts/python.exe",
      "runtimeArgs": ["-m", "uvicorn", "app.main:app", "--app-dir", "services/api", "--port", "8000"],
      "port": 8000
    },
    {
      "name": "farq-web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

If port 8000 or 5173 is already in use by a process not started in this session, **stop and ask the user** before stopping it. It may be their running copy from `main`. Then use the browser pane tools:

1. `preview_start` `farq-api`, then `farq-web`. Open `http://localhost:5173`. If onboarding shows, run `localStorage.setItem("farq.current-student","demo-student")` and reload.
2. Click **Group Projects**.
   - **Expected:** the front page shows the briefing strip with "3 new messages in Team Falcon", a **Team Falcon** cover card (SWE 363, 21%, "3 new") and a "CS 485 · Applied ML project" needs-a-team row. Take a screenshot.
3. Open Team Falcon.
   - **Expected:** the board has 6 tasks (To do 2, Doing 2, Done 2), the chat dock shows 16 messages including the Arabic one right-to-left, and the rail says **Live**. Take a screenshot.
4. Open "List non-functional requirements", set Status to **Doing** and save.
   - **Expected:** the card moves to Doing, and no banner appears.
   - Also drag the card back to To do. **Expected:** it moves and stays there after a reload.
5. Type `Testing the team chat 👋` and press Enter.
   - **Expected:** it appears once at the bottom.
   - Type `/poll Demo day? | Sun | Tue` and press Enter. **Expected:** a poll with two options.
   - Vote **Tue**. **Expected:** a count of 1 with the option highlighted.
6. Switch **Viewing as** to Sara Alharbi.
   - **Expected:** the workspace closes and the front page reloads for Sara.
   - Open Team Falcon. **Expected:** the chat shows the test message and the poll from step 5, and the header avatar initials are "SA" for her own messages.
7. Switch to **Dr. Layla Haddad (instructor)** and open Team Falcon.
   - **Expected:** there is **no chat dock**, and the "Instructor view" panel shows contribution bars and "0 of 3 complete" milestones. The front page briefing reads "… Team chats stay private to students."
   - Run `read_network_requests` with filter `messages`. **Expected:** no request to `/api/teams/*/messages`.
8. Switch back to Demo Student, open **Docs**, and select 3.2.
   - Click **Edit**, type a line, and click **Save**. **Expected:** the text is saved, and the outline's status dot turns green.
9. Run `read_console_messages` with `onlyErrors: true`. **Expected:** no errors.
10. Run `resize_window` with preset `mobile` and screenshot the workspace. **Expected:** single-column layout with no horizontal page scroll. Then run `resize_window` with preset `desktop`.

For any step that doesn't match, use superpowers:systematic-debugging, fix it, and re-run the step.

- [ ] **Step 5: Commit**

```bash
git add src/components/teams/TeamWorkspace.tsx src/components/teams/ViewAsSwitcher.tsx src/components/teams/TeamsView.tsx src/App.tsx .claude/launch.json
git commit -m "feat(teams-ui): add Group Projects section with Studio workspace and View-as switcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec §10 coverage:**
  - Sidebar item → Task 8
  - TeamsHome (briefing strip, covers with progress ring / next / unread, needs-a-team with Create team and a coming-soon Find teammates) → Tasks 1 and 4
  - Studio rail (views, members with presence) → Tasks 5 and 8
  - Board, detail sheet, Timeline → Task 5
  - DocStudio (sections, owners, locks, editor) → Task 7
  - Decisions and Charter → Task 7
  - TeamChat (threads via reply-to, reactions, pins, polls, @ autocomplete, / menu, make-task, inline cards, `dir="auto"`, search) → Task 6
  - InstructorPanel → Task 7
- **Deferred to Plan 2:** the "✦ Break down", "✦ Draft this" and "✦ Split the work" Hermes buttons, Hermes replies, proposal and vote cards, risk flags and catch-up.
- **Deferred to Plan 4:** the seven signature moments. The basic `layout` movement on board cards is kept here because it costs nothing.
- **Spec §6:** the snapshot-then-stream order, `Last-Event-ID` resume, optimistic moves with rollback through `reload()`, and presence heartbeats are all covered.
- **Rulings recorded in Global Constraints:** View-as placement, and Vitest as a dev dependency. Vitest is the only addition, and it's needed to test the reducer.
