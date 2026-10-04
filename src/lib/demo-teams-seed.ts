import type { ActivityEntry, AssignmentInfo, CourseRef, TeamInvite, TeamState, TeamMessage, TeamEvent, JoinRequestInfo } from "./teams-api"

export const DEMO_TEAM_USER = "demo-student"
export const DEMO_TEAMS_STORAGE_KEY = "waypoint.group-projects-demo.v1"
export const DEMO_TEAMS_CHANGED = "waypoint:demo-teams-changed"

export interface DemoClass {
  id: string; title: string; code: string; organizer_id: string; archived: boolean; joined: boolean
  members: Array<{ id: string; display_name: string }>; assignments: AssignmentInfo[]
}
export interface DemoData {
  version: 1
  teams: Record<string, TeamState>
  classes: DemoClass[]
  joined: string[]
  archived: string[]
  invites: TeamInvite[]
  activity: Record<string, ActivityEntry[]>
  events: Record<string, TeamEvent[]>
  requests: JoinRequestInfo[]
  codes: Record<string, { id: string; scope: "teams" | "classes"; target: string; expires_at: string }>
  openings: string[]
}

const people = [
  { id: DEMO_TEAM_USER, display_name: "Demo Student" },
  { id: "demo-noura", display_name: "Noura Al Salem" },
  { id: "demo-omar", display_name: "Omar Hassan" },
  { id: "demo-sara", display_name: "Sara Khalid" },
  { id: "demo-faisal", display_name: "Faisal Ahmed" },
  { id: "demo-lina", display_name: "Lina Mansour" },
]
const created = "2026-09-20T09:00:00Z"
const due = (day: number) => `2026-10-${String(day).padStart(2, "0")}T20:59:00Z`
const courses: CourseRef[] = [
  { id: "demo-class-se", code: "CS321", title: "Software Engineering", term: "Fall 2026" },
  { id: "demo-class-data", code: "CS342", title: "Data Science Studio", term: "Fall 2026" },
]
const projects = [
  {
    id: "demo-campus", name: "Campus Compass", course: 0, lead: 0,
    problem: "New students struggle to find accessible routes, study spaces, and support services across campus.",
    objective: "Build a campus companion that makes the first month at university easier.",
    scope: "Interactive campus map, accessible route planning, building search, and saved study spaces. The prototype covers the main campus.",
    tools: ["React", "FastAPI", "SQLite", "Figma"],
    tasks: ["Interview first-year students", "Map the accessible routes", "Write the problem statement", "Design the building search", "Implement map markers", "Build saved study spaces", "Review keyboard navigation", "Test route planning", "Add empty and offline states", "Write API documentation", "Record the walkthrough", "Prepare the final presentation"],
    chat: ["The student interviews are in the requirements document. Three people mentioned accessible routes.", "I finished the first map prototype. The building search is ready for review.", "Nice! I’ll test it with a keyboard and add notes to the accessibility task.", "Let’s keep offline maps out of this sprint and focus on saved study spaces.", "Agreed. I’ve pinned that scope decision so it’s easy to find.", "The route tests pass for the library and engineering building. One ramp is missing from our dataset."],
  },
  {
    id: "demo-study", name: "Study Circle", course: 0, lead: 1,
    problem: "Students want small study groups with clear goals, but existing chat groups become noisy and difficult to manage.",
    objective: "Help classmates find focused study circles and track shared revision goals.",
    scope: "Course-based circles, invitation links, shared revision checklists, and moderation controls.",
    tools: ["TypeScript", "React", "PostgreSQL"],
    tasks: ["Survey study group habits", "Define circle membership rules", "Sketch the join flow", "Design the revision checklist", "Build course filtering", "Implement invitation links", "Review moderation controls", "Test concurrent checklist edits", "Write onboarding copy", "Document the data model", "Run the usability session", "Prepare the demo script"],
    chat: ["The survey results are ready: most students prefer groups of four or five.", "I’ve updated the join flow so people can preview a circle before requesting a place.", "Can we make the revision checklist easier to scan on mobile?", "I’ll try grouping items by chapter. I added that to the board.", "The invitation link now expires after seven days. Tests are green.", "Let’s use the database exam topics for our demo circle."],
  },
  {
    id: "demo-energy", name: "Energy Lens", course: 1, lead: 0,
    problem: "Campus facilities teams lack a clear picture of when buildings consume unnecessary electricity.",
    objective: "Identify unusual consumption patterns and explain actionable energy-saving opportunities.",
    scope: "An anonymized hourly dataset, a reproducible analysis notebook, anomaly detection, and a small dashboard. No individual occupancy tracking.",
    tools: ["Python", "pandas", "scikit-learn", "React"],
    tasks: ["Audit the energy dataset", "Clean missing meter readings", "Create the baseline notebook", "Explore weekly patterns", "Train the anomaly detector", "Build the dashboard filters", "Review the evaluation metrics", "Validate holiday outliers", "Write the limitations section", "Package the reproducible pipeline", "Design the poster", "Rehearse the stakeholder demo"],
    chat: ["The meter readings are cleaned. I flagged the two days with incomplete data.", "The library has a surprisingly high overnight baseline. I added a chart to the report.", "Let’s compare weekdays and weekends before calling it an anomaly.", "Good point. The baseline now accounts for day of week and temperature.", "The dashboard filters work. Could someone check the chart labels?", "I’ve added the limitations: these are patterns, not proof of a fault."],
  },
  {
    id: "demo-library", name: "Library Queue", course: 0, lead: 2,
    problem: "Students cannot tell when library study rooms will be available and repeatedly check the booking page.",
    objective: "Create a fair waiting list with clear room availability and booking notifications.",
    scope: "Room availability, a waiting list, simulated notifications, and a booking history screen.",
    tools: ["React", "FastAPI", "SQLite"],
    tasks: ["Observe the booking workflow", "Define fair queue rules", "Draft user stories", "Design the room list", "Implement room availability", "Build the waiting list", "Review booking permissions", "Test queue ordering", "Add notification preferences", "Write the user guide", "Capture demo screenshots", "Prepare the handover"],
    chat: ["The library staff interview gave us a good edge case: cancelled bookings.", "I’ve documented how the next person gets offered a cancelled slot.", "The room list is ready. Available rooms are easier to spot now.", "We should keep notifications simulated for the class demo.", "Agreed. No real messages need to go out.", "I invited Demo Student to help with the usability walkthrough."],
  },
]

function makeSeed(): DemoData {
  const data: DemoData = {
    version: 1, teams: {}, classes: courses.map((course, i) => ({ id: course.id, title: course.title,
      code: course.code, organizer_id: i ? people[4].id : DEMO_TEAM_USER, archived: false, joined: true,
      members: people.map(person => ({ ...person })), assignments: [] })),
    joined: projects.slice(0, 3).map(p => p.id), archived: [], invites: [], activity: {}, events: {}, requests: [], codes: {}, openings: ["demo-library"],
  }
  projects.forEach((p, index) => {
    const teamId = p.id
    const members = people.slice(0, 4).map((person, i) => ({ user_id: person.id, display_name: person.display_name,
      role_label: "", is_lead: i === p.lead }))
    // The fourth project is an invitation rather than an existing membership.
    if (index === 3) members.splice(0, 1)
    const rubric = [
      { id: `${teamId}-r1`, title: "Research & requirements", description: "Evidence of the problem and measurable acceptance criteria.", weight: 25 },
      { id: `${teamId}-r2`, title: "Implementation", description: "A working, maintainable prototype with meaningful tests.", weight: 40 },
      { id: `${teamId}-r3`, title: "Evaluation", description: "Clear findings, limitations, and a reproducible evaluation.", weight: 20 },
      { id: `${teamId}-r4`, title: "Presentation", description: "A concise walkthrough and coherent project documentation.", weight: 15 },
    ]
    const assignment: AssignmentInfo = { id: `${teamId}-assignment`, course_id: courses[p.course].id,
      title: p.course ? "Campus data investigation" : "Student services prototype", deadline: due(28),
      brief: { problem: "Choose a campus problem and justify your approach with student or stakeholder evidence.",
        objective: "Deliver a tested prototype and explain how it addresses the problem.", constraints: ["Use anonymized or synthetic data", "Document individual contributions"],
        deliverables: ["Requirements specification", "Working prototype", "Evaluation report", "Final presentation"] },
      deliverables: ["Requirements specification", "Working prototype", "Evaluation report", "Final presentation"], rubric,
      team_size_min: 3, team_size_max: 5 }
    data.classes[p.course].assignments.push(assignment)
    const milestones = ["Requirements review", "Prototype checkpoint", "Final hand-in"].map((title, i) => ({
      id: `${teamId}-mile-${i}`, team_id: teamId, title, due: due([7, 18, 28][i]),
      deliverable_key: ["requirements", "prototype", "presentation"][i], completed_at: i === 0 ? due(2) : null,
    }))
    const proposalId = `${teamId}-proposal`
    const messages: TeamMessage[] = p.chat.map((content, i): TeamMessage => ({ id: `${teamId}-msg-${i}`, team_id: teamId,
      author_user_id: people[i % 4].id, kind: "text" as const, content, metadata: null,
      reply_to_id: i === 2 ? `${teamId}-msg-1` : null, visible_to_user_id: null,
      created_at: `2026-10-03T${String(9 + i).padStart(2, "0")}:15:00Z`, edited_at: null, deleted: false,
      reactions: i === 1 ? { "👍": [people[0].id, people[3].id] } : {} }))
    const state: TeamState = {
      team: { id: teamId, name: p.name, cover_seed: teamId, lead_user_id: people[p.lead].id, charter: {},
        created_at: created, viewer_role: p.lead === 0 ? "lead" : "member", assignment, course: courses[p.course], members, size_limit: 5,
        project: { brief: { problem: p.problem, objective: p.objective, scope: p.scope,
          constraints: ["Use fictional people and anonymized data", "Keep the prototype usable on mobile"], tools: p.tools },
          deliverables: [{ key: "requirements", title: "Requirements specification", due: due(7), doc_kind: "srs" },
            { key: "prototype", title: "Tested prototype", due: due(18), doc_kind: "sds" },
            { key: "presentation", title: "Evaluation & final presentation", due: due(28), doc_kind: "spmp" }],
          rubric: rubric.map(r => ({ name: r.title, weight: r.weight, description: r.description })) } },
      tasks: p.tasks.map((title, i) => ({ id: `${teamId}-task-${i}`, team_id: teamId, title,
        description: `${title} for ${p.name}. Record the outcome in the project documents and ask a teammate to review it.\n\nAcceptance criteria:\n- The result is understandable to a new reader.\n- Relevant edge cases are documented.`,
        status: i < 3 ? "done" : i < 6 ? "doing" : i < 8 ? "review" : "todo",
        assignee_id: people[i % 4].id, estimate_points: [2, 3, 5][i % 3], due: due([7, 12, 18, 26][Math.floor(i / 3)]),
        depends_on: i === 8 ? [`${teamId}-task-4`] : [], milestone_id: milestones[Math.floor(i / 4)].id,
        rubric_refs: [rubric[Math.floor(i / 3)].id], rationale: "Sized around one focused piece of work.",
        created_by: i % 3 === 0 ? "hermes" : "user", position: i * 1000, created_at: created, updated_at: "2026-10-03T10:00:00Z" })),
      milestones, messages: [...messages,
        { id: `${teamId}-poll`, team_id: teamId, author_user_id: people[p.lead].id, kind: "poll",
          content: "Which part should we highlight in the walkthrough?", metadata: { options: ["The user journey", "The technical approach", "The evaluation results"], votes: { [people[1].id]: 0, [people[2].id]: 2 } },
          reply_to_id: null, visible_to_user_id: null, created_at: "2026-10-03T16:00:00Z", edited_at: null, deleted: false, reactions: {} },
        { id: `${teamId}-hermes`, team_id: teamId, author_user_id: null, kind: "proposal",
          content: "Sample Hermes proposal: add two short evaluation tasks before the final walkthrough.", metadata: { proposal_id: proposalId },
          reply_to_id: null, visible_to_user_id: null, created_at: "2026-10-03T16:15:00Z", edited_at: null, deleted: false, reactions: {} }],
      decisions: [{ id: `${teamId}-decision-1`, team_id: teamId, text: p.chat[3], source_message_id: `${teamId}-msg-3`, pinned_by: people[p.lead].id, created_at: "2026-10-03T13:20:00Z" },
        { id: `${teamId}-decision-2`, team_id: teamId, text: "Use synthetic data for the demo and include limitations in the final report.", source_message_id: null, pinned_by: DEMO_TEAM_USER, created_at: "2026-10-02T10:00:00Z" }],
      documents: (["srs", "sds", "spmp"] as const).map((kind, d) => ({ id: `${teamId}-doc-${kind}`, team_id: teamId, kind,
        title: ["Requirements specification", "Design & architecture", "Delivery & evaluation plan"][d], created_at: created,
        sections: (d === 0 ? ["Purpose & scope", "User needs", "Functional requirements", "Acceptance criteria"]
          : d === 1 ? ["Architecture", "Data model", "Interface design", "Testing strategy"]
            : ["Milestones", "Responsibilities", "Risks & mitigations", "Evaluation plan"]).map((title, s) => ({
          id: `${teamId}-section-${d}-${s}`, document_id: `${teamId}-doc-${kind}`, key: `${kind}.${s + 1}`, title,
          position: s * 1000, owner_user_id: people[s].id, content_md: [
            `## ${title}\n\n${p.objective}\n\n${p.scope}\n\n**Success measure:** a new user can complete the core journey without assistance.`,
            `## ${title}\n\n${p.problem}\n\n- Student feedback guides the scope.\n- Each feature has one clear owner.\n- Review findings are recorded alongside the implementation.`,
            `## ${title}\n\n| Requirement | Validation |\n| --- | --- |\n| Works on mobile | Test at 390px width |\n| Protects personal data | Use synthetic records |\n| Explains failures | Check empty and error states |`,
            `## ${title}\n\n1. Walk through the primary user journey.\n2. Test keyboard navigation and edge cases.\n3. Ask two classmates to try the prototype.\n4. Record findings and limitations.\n\n**Open question:** which comparison makes the improvement easiest to measure?`,
          ][s], status: s < 2 ? "accepted" : "draft", lock_user_id: null, lock_expires_at: null, version: 1, meta: {} })) })),
      proposals: [{ id: proposalId, team_id: teamId, scope: "team", affected_user_id: null, kind: "task_split",
        summary: "Sample proposal: prepare a short, evidence-based evaluation", payload: { tasks: [
          { title: "Run two peer walkthroughs", description: "Observe the core journey and record friction points.", assignee_id: DEMO_TEAM_USER, estimate_points: 2, rationale: "Keep evaluation small and concrete." },
          { title: "Summarize evaluation findings", description: "Add findings and limitations to the final report.", assignee_id: people[3].id, estimate_points: 2, rationale: "Turn observations into a clear outcome." },
        ] }, status: "pending", votes: { [people[1].id]: "up" }, invoked_by: DEMO_TEAM_USER, created_at: "2026-10-03T16:15:00Z",
        expires_at: "2099-01-01T00:00:00Z", decided_at: null, decided_by: null, decided_via: null, warnings: [] }],
      last_seq: 8, last_seen_seq: 5, imports: [],
    }
    data.teams[teamId] = state
    data.activity[teamId] = ["Created the project", "Added the requirements specification", "Created the first task breakdown", "Completed the student interviews", "Updated the prototype tasks", "Pinned a scope decision", "Opened a walkthrough poll", "Hermes proposed evaluation tasks"].map((text, i) => ({
      seq: i + 1, at: `2026-10-03T${String(9 + i).padStart(2, "0")}:00:00Z`, actor_user_id: people[i % 4].id,
      actor: people[i % 4].display_name, kind: ["team.created", "document.created", "task.created", "task.moved", "task.updated", "decision.pinned", "message.created", "proposal.created"][i], text,
    }))
    data.events[teamId] = []
    data.codes[`DEMO000${index + 1}`] = { id: `${teamId}-code`, scope: "teams", target: teamId, expires_at: "2099-01-01T00:00:00Z" }
  })
  data.invites.push({ id: "demo-library-invite", team_id: "demo-library", team_name: "Library Queue", assignment_title: "Student services prototype",
    invited_user_id: DEMO_TEAM_USER, invited_by_name: "Omar Hassan", status: "pending", created_at: "2026-10-03T15:00:00Z" })
  data.requests.push({ id: "demo-lina-request", team_id: "demo-campus", team_name: "Campus Compass", account_id: "demo-lina", display_name: "Lina Mansour",
    note: "I can help test the accessible routes and review the mobile prototype.", status: "pending", expires_at: "2099-01-01T00:00:00Z" })
  data.classes[1].assignments.push({ ...data.classes[1].assignments[0], id: "demo-data-poster", title: "Open dataset poster", deadline: due(30) })
  return data
}

// The canonical demo is shipped with the app, never inserted into a product database.
// Keep its serialized baseline private; every sandbox gets independent mutable copies.
const baseline = JSON.stringify(makeSeed())
export function freshDemoTeams(): DemoData { return JSON.parse(baseline) as DemoData }
