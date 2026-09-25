# Group Projects with Hermes as a teammate: design

Status: approved in brainstorming on 2026-09-25, awaiting written-spec review.
Scope: sub-projects 1–3 of the Group Projects programme, plus the first version of the documents studio.

## 1. Intent

Farq is a university-student app whose Hermes agent knows each student through verified facts
and a personal roadmap. Group Projects adds course team projects where Hermes acts as an **AI
teammate**:

- it reads the assignment, the tasks and the documents
- it can be @mentioned in a feature-rich team chat
- it splits work in a way that is balanced and also grows each member along their own roadmap
- it drafts academic deliverables (SRS, SDS, SPMP)

The build is for a **demo or competition showcase** (option A). It is built so that real
Microsoft/university sign-in and Blackboard/Outlook course data can be plugged in later without
rewriting the team features (option C).

Success means a live demo where students view as Sara, run `/split`, watch Hermes deal the
cards, vote as Ali, see the split applied, draft an SRS section with Hermes's live cursor, and
then switch to the instructor view and see progress and risk without the chat.

### Decisions taken

| Topic | Decision |
|---|---|
| Purpose | Demo first; identity and courses ready for Blackboard and Outlook later |
| First slice | The "AI teammate" story: foundation, workspace, chat with Hermes, first version of documents |
| Course model | A course has an assignment; students form many teams under it; there is an instructor view |
| Instructor visibility | Everything except the team chat (decisions pinned from chat are visible) |
| Accepting proposals | Personal changes go to the affected member; team-wide changes need a majority vote; after 48 h the lead decides |
| When Hermes speaks | On @mention or slash command, plus a few notices triggered by data (no model deciding when) |
| Real-time transport | Event log in SQLite + SSE with `Last-Event-ID`; typing and presence in memory |
| Document editing | Sections, each with an owner and a short editing lock; no CRDT |
| Workspace layout | Studio: rail on the left, work in the centre, chat docked on the right |
| Front page | Hermes briefing strip + living cover cards |
| Signature moments | All seven; the headline moment is "Hermes deals the cards" |

### Out of scope for this spec (later sub-projects)

- **Teammate finder:** opt-in matching and teammate cards shown to non-members. In this spec the
  "Find teammates" button shows *coming soon*.
- **Team health (full version):** anonymous peer evaluation, viva prep with quizzes, a
  contribution ledger UI beyond the summary in §7.
- **Traceability graph:** requirement → design → task → test. Requirement IDs are already stored.
- **Pre-submit check through the evaluator**, a final deck through Slides, and Hackathonat bridging.
- Real authentication, and Blackboard/Outlook connectors.
- Instructors commenting on documents, and instructors authoring assignments in the UI
  (assignments are seeded).

## 2. Constraints from the existing system

- SQLite is the authoritative store. New tables come from `create_all`, and new columns on
  existing tables need `ADDED_COLUMNS` in `database.py`. This design adds tables only and does
  not alter existing ones.
- Hermes only proposes; FastAPI endpoints called by users accept. Completed and in-progress
  items are protected from proposals.
- Hermes reaches Farq only through `/internal/hermes/*` with `FARQ_INTERNAL_TOKEN`, using narrowly
  described plugin tools. No terminal, file, browser or web tools.
- Every gateway run uses `execute_with_fallback` in `services/api/app/hermes.py`. Runs return a
  finished answer and do not stream tokens.
- Only explicit statements, choices, onboarding answers and confirmed evidence become
  `StudentFact`. Team activity **must not** write facts in this spec.
- A new Hermes skill must be set up on every launch path (enforced by `test_hermes_packaging.py`).

## 3. Identity (`services/api/app/identity.py`)

- New table `users`: `id, display_name, role ('student'|'instructor'), student_id (FK students, nullable), source ('demo'|'microsoft'), created_at`.
  Every existing and new `Student` gets a matching `User` row, created lazily in
  `current_user()` the first time an `X-Farq-User` header carries a student id. Instructors are
  `User` rows with no student record.
- `current_user()` is a FastAPI dependency that reads the `X-Farq-User` header, and returns 401
  if the header is missing or unknown. It is **the only function that changes** when Microsoft
  sign-in arrives.
- The frontend sends `X-Farq-User` from `api()` in `src/lib/farq-api.ts`. The sidebar footer gets
  a **View as** switcher (seeded students + instructor) that writes `farq.current-user` to
  localStorage.

## 4. Data model (`services/api/app/teams/models.py`, imported by `models.py`)

Course layer:
- `courses`: `id, code, title, term, source ('manual'|'blackboard'), external_id` (unique `source, external_id`)
- `course_enrollments`: `course_id, user_id, role ('student'|'instructor')` (unique pair)
- `assignments`: `id, course_id, title, brief_json (ProjectBrief shape), deadline, deliverables_json (e.g. ["srs","sds","spmp"]), rubric_json, team_size_min, team_size_max, source, external_id`

Team layer:
- `teams`: `id, assignment_id, name, cover_seed, lead_user_id, charter_json, created_at`
- `team_members`: `team_id, user_id, role_label, joined_at, last_seen_seq` (unique pair)
- `team_invites`: `id, team_id, invited_user_id, invited_by, status ('pending'|'accepted'|'declined'), created_at`
- `tasks`: `id, team_id, title, description, status ('todo'|'doing'|'review'|'done'), assignee_id, estimate_points (1–8), due, depends_on_json, milestone_id, rubric_refs_json, rationale, created_by ('user'|'hermes'), position (float, for board order), created_at, updated_at`
- `milestones`: `id, team_id, title, due, deliverable_key, completed_at`
- `decisions`: `id, team_id, text, source_message_id, pinned_by, created_at`

Chat and Hermes:
- `team_messages`: `id, team_id, author_user_id (null = Hermes), kind ('text'|'notice'|'proposal'|'poll'|'system'), content, metadata_json, reply_to_id, visible_to_user_id (null = whole team; set for private notices and catch-ups), created_at, edited_at, deleted_at`
- `message_reactions`: `message_id, user_id, emoji` (unique triple)
- `team_proposals`: `id, team_id, scope ('personal'|'team'), affected_user_id, kind ('task_split'|'task_edit'|'doc_section'|'charter'|'milestones'|'section_owners'), payload_json, base_seq, status ('pending'|'applied'|'rejected'|'failed'|'awaiting_lead'|'stale'), votes_json ({user_id: "up"|"down"}), created_by_run_id, expires_at, created_at, decided_at`
- `team_agent_runs`: `id, team_id, invoked_by_user_id, trigger_message_id, command, hermes_run_id, status, stage, error, created_at, finished_at`.
  This is a separate table because `agent_runs.thread_id` is a non-null FK to `chat_threads`.

Documents:
- `team_documents`: `id, team_id, kind ('srs'|'sds'|'spmp'|'custom'), title, created_at`
- `doc_sections`: `id, document_id, key (e.g. "3.2"), title, position, owner_user_id, content_md, status ('empty'|'draft'|'accepted'), lock_user_id, lock_expires_at, version, meta_json (e.g. {"requirement_ids":["FR-3"]})`

Event log:
- `team_events`: `seq INTEGER PRIMARY KEY AUTOINCREMENT, team_id (indexed), type, actor_user_id (null = Hermes/system), payload_json, created_at`

## 5. Permissions (`services/api/app/teams/policy.py`)

`authorize(user, team, action) -> None` raises 403. It is the only place where permission is
decided, and it is used by the public endpoints and by `/internal/hermes/teams/*` (acting as the
user who invoked Hermes).

| Action | Member of team | Instructor of the course | Anyone else |
|---|---|---|---|
| view team, tasks, milestones, docs, decisions, charter, proposals | ✓ | ✓ | ✗ |
| view messages, reactions, typing, catch-up | ✓ | ✗ | ✗ |
| write tasks/docs/messages, vote, invoke Hermes | ✓ | ✗ | ✗ |
| view contribution summary and risk notices | ✓ | ✓ | ✗ |
| lead fallback on `awaiting_lead` | lead only | ✗ | ✗ |

Private messages (`visible_to_user_id`) are shown only to that user.

## 6. Real-time (`services/api/app/teams/events.py`, `src/lib/team-stream.ts`)

- `emit(db, team_id, type, actor, payload)` adds a `team_events` row **in the caller's
  transaction** (transactional outbox). Every write endpoint emits exactly one event.
- Event types: `task.created|updated|moved|deleted`, `milestone.*`, `decision.pinned`,
  `message.created|edited|deleted`, `reaction.toggled`, `proposal.created|voted|applied|rejected|stale|awaiting_lead`,
  `section.locked|unlocked|updated|drafting`, `member.joined`, `hermes.run` (stage updates), `notice.created`.
- `GET /api/teams/{id}/events` (SSE) authorizes the viewer, then polls `seq > last` every 400 ms
  in its own `SessionLocal`, the same way `evaluation_events` does.
  - Each frame is `id: <seq>\nevent: <type>\ndata: <json>`.
  - The stream resumes from `Last-Event-ID` (or `?after=`).
  - For instructors it drops `message.*`, `reaction.*` and private events.
  - Every 15 s it sends a `presence` frame and a heartbeat comment. The response sets `X-Accel-Buffering: no`.
- Short-lived signals: `POST /api/teams/{id}/presence {focus}` and `POST /api/teams/{id}/typing`
  write to an in-memory `dict[team_id][user_id] -> {focus, typing_until, seen_at}` with a TTL,
  and are sent out as `presence` frames. They are not stored.
- Frontend: `useTeamStream(teamId)` keeps one `EventSource` and reduces events into a
  normalized store (`tasks`, `messages`, `proposals`, `sections`, `presence`). Local changes are
  applied optimistically with temporary ids and reconciled when the event arrives; a failed write
  rolls back and shows a toast. The **same reducer** is used by the replay scrubber.

## 7. Workspace behaviour (`services/api/app/teams/router.py`)

- **Courses and teams:**
  - `GET /api/me/teams-home` returns courses, assignments, my teams (progress, next task, risk,
    unread count) and "needs a team" rows. Instructors get every team in their courses.
  - `POST /api/assignments/{id}/teams` creates a team with the caller as lead.
  - Invites: `POST .../invites`, `POST /api/invites/{id}/accept|decline`. The team size maximum is enforced.
- **Tasks:**
  - Create, update and delete. Moving a task sets `status` and `position`.
  - `depends_on` must stay acyclic (reuse the DAG check pattern from roadmaps).
  - Moving the last open task of a milestone to `done` sets `completed_at` and emits
    `milestone.completed`, which triggers the burst animation and a system message.
- **Decisions:** `POST /api/teams/{id}/decisions {message_id}` pins a message as a decision.
  Its text is copied, so instructors see the decision but not the chat.
- **Contribution summary:** calculated from `team_events` as done points per member and the
  number of messages per member. It is a read-only endpoint. Message counts are not shown to instructors.

## 8. Proposals (`services/api/app/teams/proposals.py`)

- **On creation:**
  - The payload is validated against the current state and `base_seq` is recorded.
  - It is **rejected immediately** if it edits or deletes a task in `doing`/`review`/`done`,
    writes to a section locked by someone else, or references unknown members or tasks.
  - `task_split` must keep each member's total points within ±20% of the team mean
    (counting existing open tasks plus new ones) and give every member at least one task.
  - `expires_at` is set to now + 48 h.
  - A `proposal` chat message is posted.
- **Deciding:**
  - `scope=personal`: only `affected_user_id` may accept or reject.
  - `scope=team`: each member votes up or down, and may change their vote while it is pending. It applies at a strict
    majority of **current** members, and is rejected once a majority is no longer possible.
- **Lazy expiry:** any read of a `pending` proposal past `expires_at` sets `awaiting_lead`. The
  lead may then apply or discard it.
- **Applying:**
  - The proposal is checked again against the current state in one transaction. If it
    conflicts, the status becomes `stale` and the card offers "Ask Hermes to redo".
  - Otherwise it writes the tasks, sections or charter and emits the events.
- **Personal kinds:** `doc_section` (to the section owner) and `task_edit` (only a task assigned to one member).
- **Team kinds:** `task_split`, `charter`, `milestones` and `section_owners`.

## 9. Hermes as a teammate

**Invocation** (`services/api/app/teams/hermes_team.py`)
- A message containing `@Hermes`, or starting with a slash command, creates a `team_agent_runs` row.
- Commands: `/split`, `/catchup`, `/describe <task>`, `/draft srs|sds|spmp [section]`, `/standup`, `/risks`.
- Hermes buttons in the UI ("✦ Break down", "✦ Draft this", "✦ Split the work") post the same
  command as a chat message from the member, so every action is visible in the chat.
- There is one run at a time per team, in a FIFO queue. Presence shows "Hermes is thinking" and the stage.
- The run goes through `execute_with_fallback`:
  - with the header `X-Hermes-Session-Key: farq:team:<team_id>`
  - with instructions that name the person who invoked Hermes, their role and the command
  - loading the `farq-team-coach` skill
- **Output:** the reply is parsed with the existing `parse_chat_output`, so the structured
  `farq-ui` controls are supported, and saved as a Hermes `team_messages` row.
- **On failure:** the failure is stored and a system message says so. No fake output is shown.

**Plugin tools** (`.hermes/plugins/farq`) call `/internal/hermes/teams/*`. Each takes
`acting_user_id` and is checked with `authorize()`:

| Tool | Behaviour |
|---|---|
| `farq_get_team_context(team_id, acting_user_id)` | Assignment brief and rubric, members' teammate cards, tasks, milestones, decisions and document outline. The last 50 team messages are included only when the acting user is a member. |
| `farq_get_task(task_id, acting_user_id)` | Full task |
| `farq_get_doc_section(section_id, acting_user_id)` | Section content and metadata |
| `farq_propose_tasks(team_id, acting_user_id, kind, tasks[])` | `task_split` or `task_edit` proposal; each task carries a `rationale` |
| `farq_propose_section(section_id, acting_user_id, content_md, requirement_ids[])` | Personal `doc_section` proposal to the section owner |
| `farq_propose_team_change(team_id, acting_user_id, kind, payload)` | `charter`, `milestones` or `section_owners` proposal |

- **Teammate card** for a member: display name, discipline, program and year, active
  `StudentFact` rows in the categories skills/goals/strengths, and the titles of the active and
  next roadmap stages. It never contains raw evidence, `suggested` items, transcripts or grades.
- **Safety:** team chat content is untrusted data. Hermes has no tool that applies a change, so
  a malicious message can at worst produce a proposal that the team has to accept.

**Skill** `.hermes/skills/farq-team-coach/SKILL.md`:
- growth-aware splitting: balance points, and give each member at least one stretch task tied
  to their roadmap, with a `rationale`
- document conventions: IEEE 29148 (SRS), IEEE 1016 (SDS), IEEE 1058 (SPMP); requirement IDs `FR-n` / `NFR-n`
- concise chat replies
- never claiming to have run code

**Documents:**
- `/draft srs` first creates the outline as the document's sections, using a JSON-only prompt on
  a throwaway `farq:teamdoc:*` session.
- It then posts a `section_owners` team proposal.
- After that it drafts each section in its own run, each producing a personal `doc_section`
  proposal to the owner.
- When a draft is created, the API emits `section.drafting` events that replay the text in
  chunks (about 40 chars every 60 ms) for the live cursor. The replay is presentation only; the
  stored draft is complete when the proposal is created.

**Notices, decided without a model** (`services/api/app/teams/notices.py`):
- **When they're checked:** on the first stream connection of each member per day, and after task writes.
- **Rules:**
  - deadline risk: remaining points divided by the average points finished per day over the
    last 7 days is more than the days to the deadline
  - a task has been in `doing` with no event for 3 days or more
  - a member has been quiet for 7 days or more; this notice is private to that member
  - a morning digest, once per member per day
- **Limits:** at most 3 team-visible notices per team per day.
- **Wording:** an optional JSON-only model run phrases the text; if it fails, a template is used.

**Catch me up:** events after the member's `last_seen_seq` are grouped by type and given to a
run as data. The result is a private message (`visible_to_user_id`), and `last_seen_seq` is
advanced. The front page's Hermes briefing strip joins the notices across all the user's teams,
without a model.

## 10. UI (`src/components/teams/`, `.fq` design language from `coach-concept.css`)

- **Sidebar:** a **Group Projects** item (lucide `Users`) placed after Projects. A **View as**
  switcher in `FooterSettings`.
- **`TeamsHome.tsx`:**
  - the Hermes briefing strip
  - `TeamCover` cards, with a gradient generated from `cover_seed`, drift on hover, a progress
    ring, "Next for you", a risk flag and an unread count
  - dashed "needs a team" rows with Create team and Invite; "✦ Find teammates" is labelled
    *coming soon*
  - instructors see every team in their courses
- **`TeamWorkspace.tsx` (Studio):**
  - **rail:** cover, views (Board · Timeline · Docs · Decisions · Charter), members with presence halos
  - **centre:** `TaskBoard` (drag physics, detail sheet, "✦ Break down"), `TaskTimeline`,
    `DocStudio` (section list with owner and lock, markdown editor, "✦ Draft this"),
    `DecisionLog`, `CharterView`
  - **right dock:** `TeamChat`
  - instructors get `InstructorPanel` (contribution summary, risk notices, decisions) in place of the chat
- **`TeamChat`:**
  - threads (reply-to), reactions, pin as decision, polls (`kind=poll`, votes in metadata)
  - `@` autocomplete for members and Hermes; a `/` command menu
  - "Make task" from any message
  - inline task, proposal and vote cards; `farq-ui` choice cards reused from `ChatThreadView`
  - `dir="auto"` on each message for right-to-left text
  - search over loaded messages
- **Signature moments** (with `motion`; each falls back to a fade under `prefers-reduced-motion`),
  in build order:
  1. **Hermes deals the cards:** when a `task_split` proposal is applied, the cards fly from
     Hermes's avatar into each member's lane and flip to show `rationale`.
  2. **Ghost tasks:** pending proposal tasks are drawn dashed on the board and spring into solid
     tasks when applied.
  3. **Live vote card:** voter avatars pop in, the bar fills, and the card folds into an "✓ Applied" receipt.
  4. **Hermes's cursor in the doc:** `section.drafting` chunks type in behind a labelled
     gradient cursor, marked *draft*.
  5. **Milestone burst:** confetti in the cover's colours on `milestone.completed`.
  6. **Presence halos and the `Ctrl/⌘K` palette:** jump to a task or section, run commands, ask Hermes.
  7. **Replay scrubber:** rebuilds the board from `team_events[0..n]` using the stream reducer.

## 11. Demo seed (`services/api/app/teams/seed.py`)

Idempotent, and run with the existing demo seeding:
- two courses: SWE 363 Software Engineering and CS 485 Machine Learning
- one assignment each, with deliverables and a rubric
- eight student users (reusing the demo student plus seven with short, varied roadmaps and facts)
- one instructor enrolled in both courses
- **Team Falcon** (SWE 363), half-finished: a charter, 6 tasks across columns, an SRS outline with
  2 accepted sections, and about 30 chat messages
- one assignment with no team for the demo student

## 12. Error handling

- Every write validates, returns 4xx with a message, and emits no event if it fails.
- An optimistic change that the server rejects rolls back and shows a toast.
- A dropped SSE connection reconnects using `EventSource`'s built-in retry, and missed events
  are replayed from `Last-Event-ID`.
- A failed Hermes run is stored with its error and posted as a system message. The queue moves on.
- Section locks expire after 90 s without a heartbeat, so a closed tab never locks a section forever.
- A stale proposal never partially applies (single transaction).

## 13. Testing

Backend (`services/api/tests/test_teams*.py`):
- the permission table, including that an instructor gets no messages from REST, SSE or the Hermes tools
- every write emits exactly one event, and a failed write emits none
- the SSE stream resumes after `Last-Event-ID` and filters by role
- proposals:
  - rejection of protected tasks and locked sections
  - the ±20% balance check
  - majority math as membership changes
  - lazy expiry to `awaiting_lead`
  - `stale` when a conflict appears between creation and applying
- the rules for milestone completion
- notice thresholds and the daily limit
- `farq-team-coach` is set up on every launch path (extend `test_hermes_packaging.py`)
- the Hermes command parser and the run queue (with the gateway mocked)

Frontend:
- `npm run build`
- a Playwright walk-through of the demo script, with screenshots: view as Sara → `/split` →
  deal animation → vote as Ali → applied → `/draft srs 3.2` → cursor replay → view as instructor
  (no chat dock)

## 14. Docs to update with the build

`AGENTS.md` (the team proposal rule, the invariant that the chat is private from instructors),
`docs/hermes-architecture.md` (team session key, tool contracts), `docs/handoff.md`, and
`docs/future-work.md` (sub-projects 4–6, and the threat model for team-chat prompt injection).
