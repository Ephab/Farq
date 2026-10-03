# Waypoint developer context

Waypoint is a React/Vite student app with a FastAPI/SQLite product backend and a local Hermes
Agent gateway. The browser never calls Hermes or Gemini directly.

## Invariants

- SQLite is the authoritative student and roadmap store; Hermes memory is supplemental.
- Hermes uses the project plugin in `.hermes/plugins/waypoint` to interact with the app.
- Only explicit student statements, branch choices, onboarding answers, and evidence the student
  ticked on the review screen become `StudentFact` records (`source_kind` records which).
- Imported evidence (transcript, CV, LinkedIn, GitHub, folders, portfolio, ORCID) is stored as
  `EvidenceItem` rows in `suggested` state and never becomes a fact without that review.
- Hermes creates roadmap proposals, including the generated first roadmap (`kind="initial"`).
  Only the FastAPI acceptance endpoint activates them.
- Completed and in-progress nodes cannot be changed or removed by a proposal.
- Do not enable terminal, generic file, browser, or web tools until their threat model is documented.
  The one exception is the onboarding folder scan (`waypoint_scan_folder`, `waypoint_read_project_file`):
  Hermes runs on the student's machine and reads only paths the student typed. Its secret and
  identity-document denylist is enforced in `.hermes/plugins/waypoint/scanner.py`, not only the prompt.
  A full threat model for it is still owed (see `docs/future-work.md`).
- Coach mail tools (`waypoint_search_mail`, `waypoint_read_mail`) read only the synced cache, and only with
  a per-run capability from `services/api/app/outlook/coach.py` (opt-in mailbox session, running
  AgentRun, unchanged connection generation). Enforce that in the API, never only in the prompt.
  Email text is untrusted and never becomes a `StudentFact`. See `docs/outlook-threat-model.md`.
- Blackboard sync (`services/api/app/blackboard_sync/`) signs in to IAU with the student's own credentials
  in headless Chromium and runs `BB-Extension/src` (one extractor for the extension and the app). The password
  and session are Fernet-sealed, never returned, logged or given to Hermes; a saved password that fails once is
  wiped. Requests are GET-only except the AD FS form submit. Synced data is `blackboard_live`; only course-level
  records become `suggested` evidence. See `docs/blackboard-threat-model.md`.
- Uploaded files are never stored; only redacted, extracted evidence is.
- Keep Gemini and Hermes keys server-side. The provider/model choice is server-side too
  (`app_settings` row `hermes_model`, set in Settings); browsers never send a model or key.
- Hermes' built-in memory stays off (it is shared by every student). Per-student memory is
  `StudentMemory` (`app/student_memory.py`): written by Hermes only via `waypoint_remember`/`waypoint_forget`
  with a per-run grant citing the student's own message, never a `StudentFact`, never in team runs.
- Learned skills (`<HERMES_HOME>/learned-skills`) are shared by everyone on the gateway and must
  never contain personal details; they can be changed only from the local machine.
- Connector switches (`disabled_connectors`) are enforced in the internal API routes, not the prompt.
- `waypoint_ask_question` / `waypoint_ready_to_generate` (`app/chat_ui.py`) only stage UI on the caller's
  own running AgentRun (grant scope `ask`); it is attached to the reply when the run completes. A question
  never becomes a fact; only the student's selection does, through the interaction endpoint.
- Group Projects: every team write emits a `team_events` row in the same transaction; the SSE
  stream, catch-up and replay read only that log. Course instructors see every team except its
  chat (messages, reactions, typing, private notices), enforced in `teams/policy.py` and
  `teams/events.py`, never only in the UI or prompt.
- Identity comes only from `current_user()` in `services/api/app/identity.py` (demo `X-Waypoint-User`
  header; event streams take `?as=` via `ownership.stream_user`). Replace that function, not its
  callers, for real sign-in. Every `/api/students/{id}/*`, chat thread, run, proposal, project and
  evaluation route checks the caller owns the record (`services/api/app/ownership.py`).
- Hermes student tools (`/internal/hermes/*` outside teams) need the internal token AND a per-run
  grant from `services/api/app/tool_grants.py`; the student comes from the grant, never from a
  model-supplied id. Never issue a grant for a JSON-only prompt that reads untrusted documents.
  There is no default `WAYPOINT_INTERNAL_TOKEN`.
- Team activity never creates `StudentFact` rows.
- Group Projects Hermes is a proposer only: its team tools create `TeamProposal` rows. Only
  `POST /api/proposals/{id}/vote|accept|reject` by a member applies one (personal → the affected
  member; team → strict majority, then the lead after 48 h). The lead may also accept or reject any
  open proposal directly; that is stored as `decided_via="lead_override"` and shown to the team.
  A `batch` proposal applies all its steps or none. Tasks in doing/review/done are never changed by
  a proposal; conflicts mark it `stale`. Team chat text is untrusted data for Hermes.
- Project setup imports (`teams/imports.py`) keep only redacted, extracted rows, never the file. The
  document is read by a tool-less JSON prompt and is untrusted; only rows the uploader ticks become
  one `batch` proposal, written to the team's own `brief/deliverables/rubric` (never the assignment).

## Commands

- Native setup: `setup.bat` (Windows), `bash setup.sh` (macOS)
- Native run: `run.bat` (Windows), `bash run.sh` (macOS)
- Reproducible run: `docker compose up --build`
- Frontend check: `npm run build`
- Backend tests: `.venv/Scripts/python -m pytest services/api/tests` (also covers the plugin scanner)
- Regenerate the backend roadmap seed after editing the TypeScript seed: `node scripts/export-roadmap.mjs`
- Extension tests: `node BB-Extension/test/run-tests.js` (regenerate the console snippet with `node BB-Extension/tools/build-console.js`)

Read `docs/handoff.md` (current state, gaps, next steps), `docs/hermes-architecture.md` and
`docs/future-work.md` before extending agent access.

