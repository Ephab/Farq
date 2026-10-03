# Hermes architecture

## Runtime

```text
React/Vite (:5173)
       |
       v
FastAPI + SQLite (:8000) ---- authoritative students, facts, chat, roadmap versions
       |
       v
Hermes Gateway (:8642) ------ sessions, memory, skills, agent loop
       |
       +---- Gemini provider
       |
       +---- Waypoint project plugin ---- authenticated calls back to FastAPI /internal/hermes
```

HTTP is only the transport into Hermes. `POST /v1/runs` starts the full Hermes agent loop,
including its session, instructions, memory, reasoning, and tool calls. Waypoint does not import
Hermes internals because its documented gateway contract is a safer upgrade boundary.

## Jev decision layer

TypeSafe Jev is an optional FastAPI-owned System One layer between normalized source data,
SQLite retrieval and Hermes context. It receives bounded, redacted snippets and returns typed
classification, actionability, urgency and roadmap-relevance decisions. In the default `shadow`
mode, decisions are audited in `decision_records` but cannot change ingestion, facts, rankings or
roadmaps. Failures are always fail-open. SQLite remains authoritative; Jev is not a memory store,
and Hermes never calls TypeSafe directly. When Jev is unavailable or fails, the same questions go
to Respan Span-01 Lite via OpenRouter, then to the local Laya checkpoint (`decision_engines.py`).

The observed ingestion purposes are co-op, Hackathonat, Blackboard, Outlook and onboarding
evidence. Coach messages are intent-routed in shadow mode. Existing deterministic shortlists for
co-op, hackathons and Blackboard can be reranked only when `JEV_MODE=active` and their exact
purpose (`coop_rerank`, `hackathon_rerank`, or `blackboard_rerank`) appears in
`JEV_ACTIVE_PURPOSES`. Low-confidence results preserve their original relative order.

## One chat turn

1. The UI saves a message through FastAPI.
2. FastAPI creates an `AgentRun`, supplies the Hermes thread session ID, and sends a unique
   idempotency key to `/v1/runs`.
3. `X-Hermes-Session-Key: waypoint:user:<id>:<session>` scopes Hermes memory to the current coach session; restoring defaults rotates that session.
4. Hermes may call Waypoint tools several times before replying.
5. FastAPI polls the durable run and exposes simplified status events to the browser via SSE.
6. The final assistant message and run result are persisted in SQLite.

Failures are stored and shown. The current roadmap is never replaced with fake output.

## Current opportunities

Hackathonat is fetched by FastAPI through a fixed read-only connector, not by a generic Hermes
browser. The API caches normalized records every six hours, scores matches deterministically,
and exposes only cached results through `waypoint_find_hackathons`. Hermes explains those matches and
may submit an opportunity-node proposal, but the API replaces model-supplied dates and links with
SQLite values before storing it. The feed's `date` is labelled "Date shown by Hackathonat" because
the public endpoint does not define it as a registration deadline. A future Outlook connector
will write into the same normalized opportunity boundary.

## Co-op discovery

Company fit and current openings are intentionally separate. FastAPI owns a curated Saudi company
catalog and bounded official-page refreshers, then deterministically ranks each company from explicit
facts, demonstrated roadmap skills and projects. Unknown eligibility stays unknown. Official
pages, the public `nobthacv1` Telegram archive and optional Apify LinkedIn results are normalized,
deduplicated and cached in SQLite. Source text is treated as untrusted data.

Hermes can only read normalized results through `waypoint_find_coop_companies`,
`waypoint_find_coop_postings` and `waypoint_get_coop_target`. It has no generic career-site browser and
cannot apply for the student. A preparation request may become an ordinary future-only roadmap
proposal; the existing validation and student acceptance boundary remains authoritative.

## Blackboard demo snapshot

For the hackathon, Waypoint treats Blackboard as already indexed. A host-side importer reads only an
explicit allowlist of local course folders, extracts text from PDF/PPTX lectures, adds visibly
synthetic demo records, and sends one authenticated normalized snapshot to FastAPI. FastAPI and
SQLite remain the source of truth; Hermes has no Blackboard cookie, password, browser, filesystem
path, binary file, or arbitrary SQL access.

The snapshot is authoritative: repeating the import upserts current records and removes stale ones.
Every record carries course identity, origin (`local_material` or `synthetic`), source reference,
timestamps and a checksum. Search returns short snippets; full reads are capped and paginated.
Retrieved material is untrusted content, not instructions to the agent. The UI and agent must call
this a **pre-indexed demo snapshot**, never a live Blackboard sync.

## Roadmap projects and evaluation

Skill-sequence stages end in a visible `nodeType="project"` milestone. The roadmap snapshot keeps
the node and its dependency position; the mutable brief, rubric, submissions and evaluation history
live in dedicated project tables linked by `projectId`. Hermes can read a project and submit a draft
refinement, but only **Save to roadmap** accepts it and versions the visible node.

Evaluation deliberately does not grant Hermes terminal, Docker or host filesystem access. A separate
host-side worker (`scripts/evaluator.ps1`) claims leased jobs through authenticated internal endpoints,
copies a filtered immutable snapshot, detects an adapter, and runs fixed recipes in disposable,
resource-limited Docker containers. GitHub, ZIP and absolute local-directory sources share this path.
The worker may download dependencies, but evaluated code receives no Waypoint credentials or database.
Evaluation completion stores evidence and a 0-100 score and marks the project node done; retakes append
history and update latest/best scores. Unsupported artifact types get a lower-coverage structural review
with explicit limitations instead of fabricated execution claims.

## Memory ownership

Hermes owns conversational continuity and agent execution. Waypoint owns verified facts and
decisions. `waypoint_record_explicit_fact` accepts only direct statements or a branch the student
selected. Reusing a category/key supersedes the old fact without erasing its audit record.

This prevents fuzzy agent memory from becoming the only record of courses, achievements,
strengths, weaknesses, or career direction.

Hermes' built-in memory (MEMORY.md/USER.md) is disabled because it is one file per gateway home,
shared by every student and team. Per-student memory is `StudentMemory` in SQLite
(`app/student_memory.py`): short notes injected into that student's coach and onboarding
instructions, written by Hermes only through `waypoint_remember`/`waypoint_forget` under a per-run
grant and citing the student's own message, and fully editable in Settings > Memory. These notes are
supplemental; they never become StudentFacts and are never given to team runs.

Skills: built-in `waypoint-*` skills are inlined into each run's instructions by
`app/hermes_skills.py`. Learned skills (written by Hermes with `skill_manage` when learning is on)
live in `<HERMES_HOME>/learned-skills`, are shared across students, must not contain personal
details, and can be archived or deleted from Settings on the local machine. Connectors (Blackboard,
hackathons, co-op, Outlook) are per-student switches enforced in the internal API routes.

The provider and model are a single server-side choice (`app_settings.hermes_model`), set in
Settings; browsers send no model or key.

## Onboarding and the first roadmap

A new student is created by `POST /api/students` with an empty v0 roadmap. Onboarding then runs:

1. **Basics**: program text is mapped to a discipline (`app/disciplines.py`) that orders the
   source cards, supplies chat question hints, and gives the generator a stage-shape hint.
2. **Sources** (all optional): transcript/CV/LinkedIn PDFs are text-extracted with `pypdf`,
   redacted (long ID numbers, emails, phones), and turned into evidence by a JSON-only run on a
   throwaway `waypoint:ingest:*` session. LinkedIn ZIP exports are parsed without a model. GitHub and
   ORCID use their fixed public APIs. A portfolio page is fetched once with SSRF guards. A
   **folder** is indexed by Hermes itself on the student's machine through `waypoint_scan_folder`
   and `waypoint_read_project_file`, which submit results with `waypoint_submit_evidence`.
3. **Review**: every `EvidenceItem` starts `suggested`. The student ticks what is true; ticked
   items become `StudentFact` rows with `source_kind="confirmed_evidence"`, the rest are dismissed.
4. **Chat**: while `onboarding_status == "chat"`, chat turns use `ONBOARDING_INSTRUCTIONS` and
   the `waypoint-onboarding` skill. Hermes reads `waypoint_get_student_profile`, asks at most five gap
   questions (ending choice questions with `Options: A | B | C`, rendered as buttons), and records
   answers with `source_kind="onboarding"`. The same thread continues as the coach afterwards.
5. **Generate**: `POST /api/students/{id}/onboarding/generate` builds a deterministic profile
   brief and asks for a whole `RoadmapSnapshot` on a throwaway `waypoint:roadmap:*` session. The
   output is validated (`validate_generated`: consistent stages, size limits, icon allowlist), and
   retried once with the error. A node may start `done` only if it cites evidence the student
   confirmed; otherwise it is reset. The result is stored as a `RoadmapProposal(kind="initial")`.
6. **Accept**: the student can untick pre-completed nodes; `accept` applies those overrides and
   creates v1. An initial proposal can only replace the empty v0.

## Model fallback on rate limits

Every gateway run (coach chat, onboarding ingest, roadmap generation, quizzes, slides) goes through
`execute_with_fallback` in `services/api/app/hermes.py`. If a run fails with a rate-limit or quota
error (429, `RESOURCE_EXHAUSTED`, 402/credits), it is retried on the next rung of `FALLBACK_CHAIN`:
Gemini Flash models newest first, then Flash-Lite, then Gemma, then Hugging Face (paid, `HF_TOKEN`)
ordered by a tool-call + strict-JSON smoke test. A rate-limited model cools down (65 s, or 30 min
for daily quotas) so later runs skip it. Other errors are reported as-is, never retried elsewhere.

## Quiz generation

`POST /api/quiz/generate` sends a JSON-only quiz prompt to `POST /v1/runs` on a
throwaway `waypoint:quiz:*` session (fresh ID per generation, tools forbidden by
instructions) and polls the durable run in a worker thread, returning the raw
model output. The prompt loads the `waypoint-quiz` skill
(`.hermes/skills/waypoint-quiz/SKILL.md`), which carries the question craft the
prompt deliberately does not duplicate: deck-spread coverage with no duplicate
stems, difficulty as the cognitive task rather than the vocabulary, distractors
a half-remembering learner would actually pick, roughly balanced true/false,
and explanations that teach instead of restating the answer. The browser keeps
its parse/salvage pipeline and turns the text into questions. Quiz source text
is never written to SQLite: it is not an explicit student statement, so it must
not become a fact, message, or proposal.

## Slide extension

`POST /api/slides/suggest` and `POST /api/slides/extend` follow the same
pattern on throwaway `waypoint:slides:*` sessions (tools forbidden, JSON-only
`{"topics": [...]}` / `{"slides": [...]}`). Slide text is never written to
SQLite for the same reason as quizzes. The extend prompt loads the
`waypoint-slides` skill (`.hermes/skills/waypoint-slides/SKILL.md`): new slides use
varied layouts (`bullets`, `steps`, `two-column`, `stats`, `quote`,
`takeaway`) with kickers and concrete visual ideas instead of uniform
title-plus-bullets, and the app renders those layouts both in the in-page
preview and in the exported file. Suggest accepts an optional
`student_id`: the API reads the verified profile brief plus the active
roadmap and injects them server-side as prompt data (confirmed facts and
evidence only, never `suggested` items awaiting review). The model marks
those topics `"source": "roadmap"` with the linked `roadmap_node`, and the
browser renders them with a distinct "For your roadmap" badge versus plain
"From this deck" topics. `POST /api/slides/export` is a local
`python-pptx` build with no model call that returns ONE file: the original
slides are kept and the AI slides are appended after a provenance divider,
reusing the deck's most-used content layout with its background and title/body
text styling copied over. PPTX originals are supplied as bytes; PDF originals
arrive as client-rendered page images embedded full-bleed. The browser previews
uploads in-page (PPTX parsed to vector shapes/text, PDF rendered to images)
and shows originals + extension as one unified deck styled with the deck's own
theme. Decks and saved extensions persist in the shared localStorage quiz
library; original files stay in memory only.

## Voice dictation

Coach and onboarding composers share a mic button (`ChatThreadView.tsx` +
`use-voice-input.ts`). The browser records with MediaRecorder and POSTs the
finished clip to `POST /api/transcribe`; FastAPI forwards the bytes to
`gemini-3.5-transcribe` (`SMART` mode, auto language detect) with the
server's `GEMINI_API_KEY` — the same provider key the Hermes gateway uses
for generation — and returns `{"text": ...}`. The transcript fills the
composer as an editable draft and is never auto-sent.

Boundaries: the browser never calls Google directly and never sees the key;
clips are capped (~10 MB, ~3 minutes), held in memory only, and never
written to disk, SQLite, or Hermes memory. A transcript becomes a message
(and possibly a StudentFact) only after the student presses Send through
the normal chat path. Mic access is per-press `getUserMedia`; denial and
missing-key states show actionable errors. True live streaming
(`gemini-3.5-transcribe-live` interim captions) is deferred future work.

## Tool contracts

- `waypoint_get_student_context(user_id)` reads active verified facts.
- `waypoint_get_active_roadmap(user_id)` reads the active version, graph, and progress.
- `waypoint_record_explicit_fact(...)` records a direct statement or explicit choice.
- `waypoint_submit_roadmap_proposal(...)` validates and stores a pending revision.
- `waypoint_get_student_profile(user_id)` reads onboarding basics, confirmed evidence and stated facts.
- `waypoint_find_hackathons(user_id, query, limit)` reads current personalized Hackathonat matches;
  it cannot navigate arbitrary URLs.
- `waypoint_scan_folder(path, purpose)` / `waypoint_read_project_file(path, root)` index a student-typed
  local folder; reads stay inside `root`, credential folders, secrets, keys and identity documents are
  refused in code, and a home folder (or its parents) cannot be scanned.
- `waypoint_submit_evidence(user_id, source_id, items)` stores suggested evidence for review.
- `waypoint_blackboard_list_courses(user_id)` lists the student's indexed courses.
- `waypoint_blackboard_list_content(user_id, course_id, content_type, limit)` lists metadata only.
- `waypoint_blackboard_search(user_id, query, course_id, limit)` searches extracted text and returns
  bounded snippets with citations.
- `waypoint_blackboard_read_item(user_id, item_id, cursor)` reads one bounded text chunk.
- `waypoint_blackboard_list_updates(user_id, since, limit)` lists snapshot changes by timestamp.

The plugin calls only `/internal/hermes/*` endpoints with `WAYPOINT_INTERNAL_TOKEN`. It never opens
SQLite. Hermes cannot accept proposals; the student-facing endpoint performs that transaction.

Every student tool also sends `grant` (`X-Waypoint-Grant`), a per-run capability from
`services/api/app/tool_grants.py`. `run_agent` issues one for each coach/onboarding run (scopes read,
facts, proposals, projects; dies with the run) and folder ingest issues one for a single folder
source (scope evidence). The API takes the student from the grant and refuses a `user_id` naming
anyone else. JSON-only prompts (CV/transcript/portfolio extraction, quizzes, slides, team imports,
roadmap generation) get no grant, so text injected into those documents cannot record facts,
submit evidence or propose roadmap changes even though the gateway still exposes the toolset.
Recorded facts must cite one of the student's own messages. There is no default internal token:
setup writes one, and without it internal routes are closed.

The `waypoint-student-coach` Hermes skill defines when these tools must be used, how explicit branch
choices become durable facts, and when Hermes must pause for a student decision. Its behavior can
be improved without changing the API or model provider.

## Roadmap safety

Proposals are operation lists: add, update, remove, move, or set dependencies. Before storage
and again before acceptance, FastAPI verifies node identity, known stages/dependencies, a DAG,
the current base version, and protection of completed/in-progress nodes. Acceptance creates a
new active version in one transaction. Rejection does not touch the roadmap.

## Adding a capability

1. Add and test a backend domain operation.
2. Add an authenticated internal endpoint containing all authorization and validation.
3. Register a narrowly described plugin tool that calls that endpoint.
4. Update `SOUL.md`, this document, and the threat model.
5. Never expose a database handle, shell, or generic arbitrary-URL tool as a shortcut.

## Group Projects teammate

A team message that starts with a slash command (`/split`, `/describe`, `/draft`, `/standup`,
`/risks`, `/catchup`) or mentions `@Hermes` queues a `TeamAgentRun`. Runs execute one at a time
per team (FIFO, `app/teams/hermes_team.py`) through `execute_with_fallback` on the session
`waypoint:team:<team_id>`. The input names `team_id` and `run_id`, and the instructions load
the `waypoint-team-coach` skill. The tab's gateway key is held in memory for that run only. Replies
are posted as Hermes team messages, and `/catchup` replies are private to the person asking.
Failures post a private system message; there is no fake reply.

Team tools take `run_id`, and the API acts as that run's invoker (the run must be `running` and
belong to the team), never as a user id the model names. Instructors get no chat:
- `waypoint_get_team_context(team_id, run_id)`: brief, rubric, teammate cards (active
  skill/goal/strength/interest facts and roadmap stage only), tasks, milestones, decisions,
  document outline, open proposals, and for members the last 50 chat messages.
- `waypoint_get_task`, `waypoint_get_doc_section`: one record in full.
- `waypoint_propose_tasks` (`task_split` | `task_edit`), `waypoint_propose_section`,
  `waypoint_propose_team_change` (`charter` | `milestones` | `section_owners`): create proposals.
  The API validates them (balanced split within max(2, 20%) of the mean, every member gets a
  task, to-do tasks only, unlocked sections only) and returns the reason on 422 so Hermes can
  retry once.

Risks (`app/teams/notices.py`) are computed without a model: deadline pace, tasks in Doing for
3+ days, members inactive for 7+ days (private). They are posted as notices when a member's
stream connects, at most 3 team notices per team per UTC day.

## Integrated email Q&A and Coach tools

Email Q&A and Coach use `HERMES_URL` (port 8642), one process and one runtime home.
The legacy `HERMES_EMAIL_URL` alias is kept equal by setup; routing uses HERMES_URL.
Selected-email Q&A keeps a fresh conversation and a 24,000-character bound, but
shares the gateway's tools and memory. No process-level isolation is claimed.

In Emails, the student may enable Coach mailbox search for their private browser
mailbox session. On a Coach message, `current_user()` authenticates that cookie;
a random, hashed, ten-minute capability binds the run to that session, connection
and connection generation. Only the capability enters the agent prompt. Internal
`waypoint_search_mail` / `waypoint_read_mail` endpoints require the internal service token,
a running personal run, an active consented session and the unchanged connection.
They query only owned, unexpired, nonremoved cache rows. Reads are paginated; no
Graph/COM credentials or write operations are exposed to Hermes. Student IDs and
team runs cannot authorize mailbox access. Revoking consent deletes the grants;
disconnecting or reconnecting invalidates them. Email content stays untrusted and
must not become StudentFacts or accepted roadmap changes.

Classic Outlook and temporary Graph tokens share the local Laya/cache path.
Native entrypoints are setup.bat/run.bat (Windows), setup.sh/run.sh (macOS).

## Public learning updates

FastAPI owns a versioned Reddit/X topic catalog, explicit subscriptions, shared redacted public post
cache, isolated dismissals and a durable Apify budget/refresh queue. Hermes reads only bounded
cached results via waypoint_find_learning_updates/waypoint_get_learning_update with a running
student READ grant. Social text is untrusted and never becomes facts or memory. Roadmap changes
remain ordinary accepted proposals. See [threat model and rollout](learning-updates-threat-model.md).
Paid refreshing ships disabled pending policy, identity, pricing and live smoke checks.
