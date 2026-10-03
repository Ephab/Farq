# Handoff: onboarding, evidence, first roadmap, model fallback

## Jev / TypeSafe decision layer

- `app/decisions.py` owns TypeSafe calls, redaction, caching, audit records and fail-open behavior.
- The default is `JEV_MODE=shadow`; do not activate a purpose without a labeled evaluation set.
- Diagnostics live at `/api/decisions/status` and `/api/decisions/recent`; source bodies are never persisted there.
- The browser shows only a global observing/active/degraded badge. The TypeSafe key stays in FastAPI.
- Jev cannot create facts, write Hermes memory, delete records, or modify roadmap state.
- `app/decision_engines.py` is the engine chain behind the gate: Jev (TypeSafe) -> Span-01 Lite
  (`respan/span-01-lite` on OpenRouter's `/api/v1/systemone`, `OPENROUTER_API_KEY`) -> local Laya.
  Unconfigured engines are skipped; `DecisionRecord.model` shows which engine answered and
  `error_category` lists failed legs (e.g. `jev:timeout`). Span answers only `noul`, so choice and
  score questions are rewritten per option/level and folded back. With Laya installed and no keys,
  the gate now observes locally; the first call cold-loads the model (~6 s), including in rerank
  request paths.
- Settings is a wide dialog with sections in a side rail (General, Models & API keys, Memory, Skills, Connectors, Your data);
  on phones the rail becomes a tab row.
- Engine switch (Settings > Models & API keys): `auto` (default, full chain), `jev` (cloud only, Laya is
  never loaded, email classification raises instead of falling back to it) and `laya` (local only). Stored in
  the `app_settings` table (`decision_engine`), read by `decision_engines.engine_choice()`, applied without a
  restart. `app/connections.py` serves `/api/settings/connections` (key presence, source `.env` vs process
  environment, masked last-4 hint only for loopback callers), per-key `PUT .../{id}` (writes `.env`, loopback
  plus Origin check; Jev/Span/Apify apply live, Gemini/NVIDIA/HF need the gateway restarted) and `POST .../{id}/test`.
- Emails: the student picks the classifier (default Laya) in the Emails panel; cloud engines fall
  back down the same chain. See `outlook-threat-model.md`.

## Blackboard live sync (2026-10-03)

- Shipped: one extractor (`BB-Extension/src`) shared by the extension and the app; headless-Chromium AD FS
  sign-in, sealed credentials, 6 h periodic sync with lockout-safe retries, redacted attachment text,
  `blackboard_live` ingest (demo rows replaced), Hermes course tools with live standing/instructors/due-ordered
  assignments, and the My data Blackboard card plus Today deadlines panel (en/ar). Threat model:
  `docs/blackboard-threat-model.md`.
- Manual live-smoke result: NOT run yet. Only the student may type their IAU credentials, so this is
  unverified against the real portal. To run it: start with `run.bat`, open My data, use the Blackboard card
  to sign in, wait for the sync to finish, then compare counts with the 2026-10-03 export: 62 courses
  (16 current), 341 assessments, 305 announcements, 314 grades, 275 content items; that export had 0 events
  and 189 failed sources, so events should now be non-zero and failed sources far fewer.
- Follow-ups: MFA support (`extra_verification` today), a hosted secret store, and the extractor's
  `captureSamples` debug option for diagnosing new portal shapes.

State as of 2026-09-25. Read this, then `AGENTS.md`, `docs/hermes-architecture.md` and
`docs/future-work.md` before changing this area.

## What was built

### Roadmap view, lifecycle and history
- The roadmap view (`src/components/roadmap/`) is a roadmap.sh-style vertical flow: stages are filled boxes on
  a central spine, topics hang off both sides (one column on narrow containers, mirrored in RTL). It is
  plain DOM (no pan/zoom canvas); `RoadmapCanvas` keeps its props so onboarding previews reuse it.
- Header actions: **Ask coach to change it** (prefills Hermes Coach), and a **Roadmap options** menu with
  Generate new roadmap, Version history, Reset progress and Remove this roadmap. (The old "How your roadmap works"
  explainer was removed.) Pending coach proposals render inline with a
  per-operation diff and Accept/Reject (`PendingChanges.tsx`); stale or protected-node proposals cannot be accepted.
- Backend (all owner-checked): `GET /api/students/{id}/roadmap/versions`, `GET .../versions/{version_id}`,
  `POST .../roadmap/archive` (removes the roadmap: the active version becomes an empty one, the old version
  stays in history, pending proposals are rejected) and `POST .../versions/{version_id}/restore` (copies an
  old snapshot forward as a new version). History is never rewritten or deleted.
- Generating a replacement is unchanged in kind: the UI archives the current roadmap (the empty roadmap is the
  only base an `initial` proposal may replace), calls `/onboarding/generate`, and shows the draft for review. Nothing
  is active until `POST /api/roadmap-proposals/{id}/accept`. If generation fails the previous roadmap is restored.
  A student whose onboarding is `done` stays `done` while regenerating.

### Outlook and local setup (2026-09-27)
- Exactly two mailbox methods: native Windows classic Outlook and a temporary
  Microsoft Graph access token. Entra/OAuth/device-code routes and MSAL are removed.
- Classic Outlook asks only for a browser consent checkbox. Setup generates its
  server-only local token after a passive capability probe; browser consent is
  protected by same-origin/localhost checks and expiring one-time cookies.
- Both methods share full cleaned-text caching, local Laya suggestions and one
  Emails workspace. Home's email widget is in the right column. Cache retention
  is 30 days; classifications never become StudentFacts or team events.
- Windows: `setup.bat`, `run.bat`. macOS: `bash setup.sh`, `bash run.sh`.
  Shared setup manages uv/Python/locked dependencies, verifies Hermes and Laya,
  installs frontend packages and generates missing `.env` secrets without rotating
  valid existing credentials. Duplicate pip and platform setup paths are removed.
- Coach and selected-email Q&A share the gateway at port 8642. Opt-in Coach mail
  search uses expiring run capabilities and read-only cached-mail tools. Explicit
  consent is required before sending email text to configured AI providers.
- See `outlook-setup.md` and `outlook-threat-model.md` for setup, privacy and upgrades.
  Tests mock Microsoft; live tenant policy and macOS setup require target-device checks.

### Personalized Saudi co-op discovery
- Sidebar **Co-op** ranks a checked-in catalog of Saudi organizations from verified student facts,
  completed/in-progress roadmap skills and projects. It separates stable company fit from current
  postings and supports save/dismiss, official-source links and a responsive detail sheet.
- Official public career/program pages, the public `nobthacv1` Telegram archive, and an optional
  Apify LinkedIn Jobs actor feed a canonical posting cache. Cross-source duplicates merge while
  retaining every provenance link. Telegram refreshes every 30 minutes; official and LinkedIn
  sources refresh every six hours. Failures preserve the last good cache.
- Live refresh (`services/api/app/coop_refresh.py`): a scheduler starts with the API (independent of
  `OPPORTUNITY_SYNC_ENABLED`; disable with `COOP_SYNC_ENABLED=false`) and runs each source when its
  last persisted run is past its interval: employer career-site RSS feeds (SuccessFactors, key-free:
  Tahakom, stc co-op categories, KAUST filtered) and Telegram every 30 min, official pages and
  LinkedIn every 6 h, failed sources retry after 5 min. A feed that answers successfully retires
  postings it no longer lists. `POST /api/students/{id}/coop/refresh` is the "Refresh now" button
  (global 60 s cooldown, LinkedIn at most hourly because it spends Apify credit);
  `GET .../coop/sources` reports per-source ok/partial/failed/not_configured/running and
  `last_updated_at`, which the UI polls. `POST .../coop/visit` records the last visit so postings
  first seen after it carry `is_new`. Postings past their stated deadline are dropped.
- Telegram is read through its public archive without a bot. LinkedIn runs only when
  `APIFY_API_KEY` exists and is bounded by `APIFY_MAX_TOTAL_CHARGE_USD`. External text is treated
  as untrusted data; only normalized SQLite records reach Hermes.
- Hermes has three read-only tools: `waypoint_find_coop_companies`, `waypoint_find_coop_postings` and
  `waypoint_get_coop_target`. "Build preparation plan" hands Coach the canonical target id; Hermes
  may submit a future-only roadmap proposal, but cannot apply or change the roadmap itself.
- This slice does not submit applications, access authenticated Jadarat/LinkedIn accounts, send
  emails or track interviews. Those remain future work.

### Group Projects (course teams with Hermes as a teammate)
- Spec: `docs/superpowers/specs/2026-09-25-group-projects-design.md`; plans 1-3 in
  `docs/superpowers/plans/`. Backend in `services/api/app/teams/`, UI in `src/components/teams/`.
- Demo: sidebar **Group Projects** → Group 1 (SWE 363). "Viewing as" switches the acting user
  per tab (students, or Dr. Layla Haddad as instructor, who sees no chat).
- Hermes: `@Hermes` and `/split`, `/describe`, `/draft srs 3.2`, `/standup`, `/risks`, `/catchup`.
  Every change is a proposal card (vote, accept or lead decision). Hermes can send many changes as
  one `batch` card (e.g. several `task_merge` steps to compress the board), applied all-or-nothing.
  An uneven workload is a warning on the card, not a rejection. The lead can accept or reject any
  open card directly (recorded as a lead override).
- Project setup (Charter & brief view): a member uploads the project description (PDF, DOCX or
  text); Hermes extracts brief, deliverables, milestones and rubric rows; the uploader fixes and
  ticks them (relative dates like "week 14" must get a real date) and sends one batch to the team.
  Spec: `docs/superpowers/specs/2026-09-28-project-setup-import-design.md`.
- Next: Plan 4 (signature animations and a Playwright demo). Deferred review minors are listed in
  the plan final reports.

### Read-only Blackboard demo retrieval
- A host-side importer converts an explicit allowlist of five local PDF/PPTX lecture folders into
  an authoritative normalized snapshot. Synthetic syllabi, announcements and assignments are
  marked `origin="synthetic"`; binaries and Blackboard credentials are never stored.
- Five bounded Hermes tools list courses/content, search snippets, paginate item text and list
  updates. All calls are student-scoped and authenticated through `/internal/hermes/*`.
- Blackboard text is treated as untrusted data. Hermes must cite course/item records and must never
  claim the snapshot is live. Re-imports upsert current material and remove stale records.
- Import: `.venv\Scripts\python.exe scripts\import_blackboard_demo.py --root "D:\mmahf\Downloads\University\University"`.
  Smoke: `.venv\Scripts\python.exe scripts\smoke_blackboard_tools.py`.

### Project milestones and evaluator backbone
- Staged generation now labels stage types and requires one final project for each new
  `skill_sequence`; legacy plans without stage types remain readable.
- Roadmap project nodes materialize into persistent briefs with weighted rubrics, explicit draft
  acceptance, submissions, evaluation attempts, latest/best scores and completion history.
- Firas's Projects view is extended into Brief, Refine, Submit and Evaluations workspaces. Project
  nodes open it on double-click/right-click; normal nodes keep their completion shortcut.
- Hermes has bounded `waypoint_get_project` / `waypoint_submit_project_refinement` tools and a
  `waypoint-project-coach` skill. Drafts never apply themselves.
- `scripts/evaluator.ps1` starts the authenticated host worker. It accepts public GitHub, ZIP and
  local-directory snapshots and runs only fixed recipes inside disposable limited Docker containers.
- Evaluation progress is available through SSE. A successful evaluation marks the milestone done at
  any score; the rating communicates quality separately and can be improved through retakes.

### Current Saudi hackathons
- Hackathonat is the primary cached source. FastAPI refreshes its public JSON feed every six hours
  in Docker, preserves the last good cache on failure, and ranks matches without an LLM.
- Hermes can only read matches through `waypoint_find_hackathons`; generic web/browser tools remain
  disabled. Dates and links in assistant controls and proposals are resolved from SQLite.
- Coach shows an unseen-opportunity badge and sourced cards. Accepted opportunity proposals become
  roadmap nodes with source date, location, registration link, and retrieval provenance.
- The source's `date` is always labelled "Date shown by Hackathonat", never assumed to be a deadline.

### 0. Structured Hermes conversations
- Hermes can append a validated `waypoint-ui` JSON block to a concise reply. The API removes the
  block and persists it in `ChatMessage.metadata_json`; malformed blocks degrade to plain text.
- Both Coach and onboarding render 2–3 rich single- or multi-select cards plus up to three
  gray **Explore next** actions. Single choices and follow-ups send immediately; multi-select
  waits for Continue.
- Interaction submissions reference their assistant message. The API rejects stale, duplicate,
  cross-thread, unknown, or out-of-bounds selections and sends Hermes canonical choice context.
- Historical choices remain visible and selected after reload. The old `Options: A | B | C`
  parser remains for existing conversations.

### 1. Onboarding → personalized first roadmap
A new student no longer gets the seeded Computer Vision roadmap. Flow (UI in `src/components/onboarding/`):

1. **Sign in** (`OnboardingView.tsx`): `POST /api/students` creates a student with an empty v0
   roadmap, a profile and a coach thread. The browser remembers the id (`waypoint.current-student`
   in localStorage). No auth yet. "Explore the demo student" still works.
2. **Basics** (`BasicsStep.tsx`): university, program, year, graduation. Program text is mapped
   to a discipline by `services/api/app/disciplines.py` (student can override).
3. **Connect** (`SourcesStep.tsx`): every source optional, ordered per discipline:
   transcript PDF, CV PDF, LinkedIn export ZIP, LinkedIn PDF, GitHub, local folder, portfolio
   URL, ORCID. "Coming soon" ideas per discipline are shown but not built.
4. **Review** (`EvidenceReview.tsx`): all imported items are `EvidenceItem(status=suggested)`.
   Ticked items become `StudentFact(source_kind="confirmed_evidence")`; unticked are dismissed.
5. **Chat** (`OnboardingChat.tsx`): Hermes runs with `ONBOARDING_INSTRUCTIONS` + the
   `waypoint-onboarding` skill, asks ≤5 gap questions, ends choice questions with
   `Options: A | B | C` (rendered as buttons by `ChatThreadView.tsx`), records answers as
   `source_kind="onboarding"` facts.
6. **Generate & preview** (`RoadmapPreview.tsx`): `POST /api/students/{id}/onboarding/generate`
   builds a profile brief and asks Hermes for a full `RoadmapSnapshot`. `validate_generated`
   (`schemas.py`) enforces layout, size and icons, and resets any `done` node that does not cite
   confirmed evidence. Stored as `RoadmapProposal(kind="initial")`; the student unticks
   pre-completed nodes and accepts → v1.

### 2. Adding records later
Sidebar **My data** (`MyDataView.tsx`) reuses Connect + Review (new items only), then hands a
prefilled message to Hermes Coach, which reads `waypoint_get_student_profile` and submits a normal
future-only proposal. Nothing regenerates from scratch; protected nodes stay protected.

### 3. Evidence sources (`services/api/app/sources/`)
| Source | How | Model? |
|---|---|---|
| Transcript / CV / LinkedIn PDF | `pdf_text.py` (pypdf[crypto], redaction of IDs/emails/phones) → `extract.py` | yes (JSON-only `waypoint:ingest:*`) |
| LinkedIn ZIP | `linkedin_zip.py` CSV parse | no |
| GitHub | `web.py fetch_github` (public API, optional `GITHUB_TOKEN`) | no |
| ORCID | `web.py fetch_orcid` (public API) | no |
| Portfolio URL | `web.py fetch_page_text` (https only, private-IP/SSRF guard, 1 MB cap) → `extract.py` | yes |
| Local folder | Hermes plugin tool `waypoint_index_folder` (`.hermes/plugins/waypoint/scanner.py`) | one tool call |

Uploaded files are never stored. Evidence is deduped by `fingerprint` (git remote, course code, DOI…).

**Extraction speed (2026-10-01).** CV/transcript/LinkedIn-PDF/portfolio extraction no longer runs an
agent loop. `sources/extract.py` tidies the text, splits documents over ~7k chars into ~5k chunks,
and extracts them in parallel (4 workers) through `app/llm_direct.py`: a tool-less structured JSON
call from FastAPI straight to Gemini (`gemini-3.5-flash-lite` first, then 3.1 lite, 3.8/3.5 flash)
and NVIDIA `nemotron-3-super-120b` (server `NVIDIA_API_KEY`, or an nvapi tab key), 25-50 s per
attempt and an immediate hop on 429/503. No grant is issued; keys stay server-side. The Hermes
gateway is only the fallback (60 s) when no direct key works. Results are cached in memory by
content hash. Set `WAYPOINT_DIRECT_EXTRACT=off` to force the gateway (tests do). Folder indexing
still needs the gateway (one tool call) and starts on `gemini-3.5-flash-lite` when `GEMINI_API_KEY`
is set. Upload/sync endpoints accept `?background=true`: they validate at once, return, and the
browser polls `GET /sources` for `stage` (queued/reading/extracting/saving), `progress`,
`elapsed_seconds` and `note` (`sources/jobs.py`, process-local). Sources left `syncing` by a
restart are reported failed. Review groups suggestions by source with select all/none.

### 4. Folder scanning (Hermes on the student's machine)
`scanner.py` walks a student-typed path, skips dependency trees (any dir with `pyvenv.cfg`,
`node_modules`, `.git`, build dirs), never opens secret-like or identity files (denylist in code),
and maps projects/coursework to evidence deterministically. Real run on a CS student's folders:
34 projects + 29 courses in ~0.6 s. `waypoint_scan_folder` / `waypoint_read_project_file` still exist for
deeper inspection but the onboarding prompt uses only `waypoint_index_folder`.

### 5. Models and fallback (`services/api/app/hermes.py`)
- Providers: Gemini, NVIDIA NIM, Hugging Face (`HF_TOKEN` in server `.env`, provider slug
  `huggingface`, model ids like `deepseek-ai/DeepSeek-V4.1-Flash:deepinfra`) and OpenRouter
  (`OPENROUTER_API_KEY`, the same key Span-01 Lite uses; `OPENROUTER_CHAIN`, currently the free
  `stealth/space-bunny-alpha`, which may log prompts). The gateway reads the key from its own
  environment, so it must be exported or saved in Settings > Models & API keys (OpenRouter row),
  then the gateway restarted.
- One server-wide provider and model, chosen in Settings > Models & API keys (or the compact picker in
  onboarding) and stored in the `app_settings` row `hermes_model` (`app/app_settings.py`). It applies to
  the next run without restarting anything and never rewrites `.env`; `HERMES_PROVIDER`/`HERMES_MODEL`
  are only the default before anyone chooses. The browser no longer sends a provider, model or key with
  requests (the per-tab sessionStorage override was removed). The catalog of providers, models,
  labels and notes is `PROVIDERS` in `hermes.py`; `GET /api/settings/models` serves it with key status.
- Every gateway run (chat, ingest, roadmap, quiz, slides) goes through `execute_with_fallback`:
  any model-side failure (429/quota, 503, failed/cancelled run, empty answer, >120 s) moves to
  the next rung of `FALLBACK_CHAIN`: Gemini 3.8 → 3.7 → 3.6 → 3.5 → 3 → 2.5 Flash → Flash-Lite
  (3.5, 3.1, 2.5) → Gemma 4 → OpenRouter → Hugging Face (DeepSeek V4.1 Flash, Gemma 26B novita,
  gpt-oss-20b, Gemma 26B deepinfra, Llama 3.1 8B). An explicit OpenRouter choice tries its model first,
  then the whole chain. Rungs whose optional key (`OPENROUTER_API_KEY`, `HF_TOKEN`) is unset are skipped.
  Model-busy errors reach the student as one plain sentence (`runErrorMessage`). Failing models cool down (30 s / 65 s / 30 min for daily quota).
- A 429 on **run creation** is the gateway's own concurrency cap: we wait for a slot, we do not
  skip models. Only a rejected Waypoint gateway key (401) stops immediately.
- Each fallback rung runs on a fresh gateway session (`<session>-r<n>`), so a retry never sees the
  failed attempt's half-finished turn. A rung that times out also rests (180 s), so the next run does
  not wait the full timeout on the same stuck model.
- Tool-less JSON prompts (quiz, slides, roadmap plan/stages, project import) whose chosen model is
  Gemini go straight to the Gemini API (`_direct_json` + `llm_direct.run_direct_json`), skipping ~6k
  tokens of tool schemas and the agent loop; everything else, and every failure, uses the gateway.
  NIM direct was measured and was not faster, so NIM stays on the gateway.
- Hermes runtime config (`services/hermes/config.yaml`): `agent.api_max_retries: 1` and
  `agent.auto_recovery_cycles: 0` (Waypoint does the fallback; Hermes' own recovery slept 15-60 s per
  cycle before giving up), `auxiliary.title_generation.enabled: false` (an extra model call per new
  session), `tools.tool_search.enabled: "off"` (no discovery round trip),
  `max_concurrent_runs: 8`.
- HF smoke test (tool call + strict JSON, 2026-09-24): DeepSeek V4.1 Flash best (both, ~2 s);
  Gemma 26B novita good; gpt-oss-20b fastest but missed a tool call; Gemma 26B deepinfra slow
  (~30 s); Llama 3.1 8B nscale failed both. Gemma via the Gemini API does not call tools.

### 5a. Memory, skills and connectors (Settings)
- **Memory** (`app/student_memory.py`, Settings > Memory): Hermes' built-in MEMORY.md/USER.md is off
  (one file per gateway home, shared by every student). Waypoint keeps up to 40 short notes per student
  in SQLite (`StudentMemory`) and puts them into that student's coach/onboarding instructions, so recall
  costs no tool call. Hermes adds or retires notes only via `waypoint_remember`/`waypoint_forget` with a
  per-run grant, citing one of the student's own messages; secrets are refused. Notes never become
  StudentFacts and never reach team runs. The student can add, edit, delete, clear or turn memory off.
- **Skills** (`app/hermes_skills.py`, Settings > Skills): each built-in `waypoint-*` skill is listed with
  the actions that use it and is inlined into the run's instructions (no `skill_view` round trip).
  "Learn new skills" lets Hermes write procedures with `skill_manage` into `learned-skills/` (shared, no
  personal details per the `waypoint-memory` skill); learned skills can be viewed, turned off (archived)
  or deleted. Changing skills is allowed only from the machine running Waypoint.
- **Connectors** (Settings > Connectors): per-student switches for the Waypoint data Hermes may read
  (Blackboard, hackathons, co-op, Outlook). A switched-off connector's internal tools return 403 in the
  API. Arbitrary MCP servers were deliberately not added: AGENTS.md forbids new tool surfaces without a
  threat model.

### 5a-2. Live run progress, question cards, readiness (2026-10-02)
- `execute_with_fallback` follows the gateway's `/v1/runs/{id}/events` SSE stream (keepalive 10 s)
  instead of polling: a model that sends nothing for `STALL_SECONDS` (45 s) outside a tool call is
  abandoned and benched for 60 s (was: wait out 120 s, bench 180 s). Test doubles without `stream`
  still poll.
- `hermes.RunProgress` keeps phase (thinking/tool/writing/queued), tool, model, steps with timings,
  tokens and tok/s, the reply streamed so far and a fallback notice in `LIVE_PROGRESS` (in-process).
  The run-status stream and `GET /api/agent-runs/{id}` include it as `progress`; `RunProgress.tsx`
  renders it in place of "Thinking…".
- NIM falls back to the nearest smaller model first, then larger (Lightning → Super → Ultra), never
  straight from the fastest to the slowest.
- Choice cards are a tool call now (`waypoint_ask_question`, 2-4 options, multi-select, follow-ups,
  hackathon ids) instead of a fenced JSON block NIM models ignored; the block parser remains as a
  fallback. Onboarding's Generate button appears only after `waypoint_ready_to_generate`; before
  that the header offers a quiet "Skip the questions" once the student has answered.
- Request schemas inherit `ServerChoosesModel`: a provider/model sent by an old tab is dropped, so
  only the Settings choice applies (a stale tab had been forcing Ultra on roadmap generation).
- Settings > Models & API keys has **Check speed** (`POST /api/settings/models/speed`, local only):
  one tiny streamed prompt per model of the provider, showing first-token time and tok/s. On
  2026-10-02 NVIDIA's hosted Lightning took 15-25 s to start while Super took 0.4-2.6 s, so static
  "fastest" labels were removed.

### 5b. Speed profile (2026-10-02)
- Coach turn: was ~3.5 min (Gemini 503 + Hermes auto-recovery sleeps + a title call + a retry on the
  same session) and later 75 s on NIM with 8 model calls (the fact tool was called up to 5x per fact).
  `waypoint_record_explicit_fact` is now idempotent and says "stored, do not repeat"; a turn is ~3 calls
  with ~1.3 s of Waypoint/gateway overhead. The rest is the model: Nemotron Ultra ~11 tok/s (~80 s per
  reply), Super ~9-20 s, Gemini Flash a few seconds.
- JSON features: ~1-3 s overhead on the gateway; quiz on Ultra 35 s, Super 20 s, Gemini direct ~9 s.
- `useActiveRun` polls every 2 s only while a run is live (15 s idle, instant on send/visibility).

### 6. Smaller fixes
- `services/api/tests/conftest.py`: documented pytest command works without PYTHONPATH.
- `scripts/runtime.py`, shared by `scripts/run_mac.py` and `scripts/run_windows.py`,
  re-copies config, SOUL, plugin and all skills into `.hermes-runtime` each start
  (every dir under `.hermes/skills`); Docker mounts each
  skill into `/opt/data/skills`. `tests/test_hermes_packaging.py` fails if a checked-in skill is not
  provisioned on every launch path.
- `database.ensure_added_columns()` adds new columns to existing SQLite DBs (no migration tool).
- Roadmap header uses the snapshot title; `RoadmapView` refetches on `waypoint:roadmap-changed`.
- Hermes Coach and onboarding chat share `use-hermes-chat.ts` + `ChatThreadView.tsx`.

## Verification status
- Automated (2026-10-01): 395 backend tests (`.venv/Scripts/python -m pytest services/api/tests`),
  70 Vitest tests, `npm run build` and `npm run lint` (warnings only) pass. The app was driven in
  Chromium (demo student across every view; a new student through sign-in, reload and resume in
  Arabic with a dark theme) with no failed API calls.
- Verified live: the Telegram public archive returned and parsed 18 current co-op posts on
  2026-09-27. The Apify actor was separately smoke-tested with real Saudi internship results.
- Verified live: sign-in, basics, GitHub import (37 repos), transcript/CV/LinkedIn PDF/portfolio
  extraction, scanner on real folders, Gemini Flash-Lite through the gateway.
- **Not yet verified live end to end:** folder indexing via `waypoint_index_folder` after the
  restart, the onboarding chat, roadmap generation + preview + accept, My data → Hermes
  proposal, Hugging Face through the gateway (the running gateway lacked `HF_TOKEN`).

## Audit remediation (2026-10-01)
A full audit fixed these areas; see the commit messages on `claude/loving-noether-0dehzi` for detail.
- **Security:** per-run Hermes tool grants (`tool_grants.py`), ownership checks on every student
  route through `current_user()` (`ownership.py`; the browser sends `X-Waypoint-User`, event
  streams `?as=`), one constant-time internal-token check with no public default
  (`internal_auth.py`), scanner path containment, loopback-only `/api/settings/hermes`, bounded
  upload/voice reads, gateway bound to loopback for native runs.
- **Roadmap:** proposals cannot add started/evidence-linked nodes, edit structure/type/opportunity
  fields through `update_node`, or remove prerequisites of started work; accept/reject/complete are
  conditional updates plus a unique active-version index; the readiness gate is enforced by the API;
  the staged SSE stream always cleans up; a bulk progress endpoint backs Reset.
- **Model fallback:** default model is the top Gemini rung; network errors and lost polls descend the
  chain; only rate limits/overload cool a model; abandoned gateway runs are cancelled (best effort).
- **Quizzes, slides, co-op, UI:** see the per-area commits (answer-key resolution, shared library
  merge-writes, PPTX parsing, export aspect/sanitizing, co-op matching/dedupe/expiry, theme tokens,
  UTC timestamps, chat stream fallback, accessibility and i18n).

## Known gaps
- Demo identity only: `current_user()` trusts the `X-Waypoint-User` header (and `/api/students`
  lists local profiles for the welcome page). Ownership is enforced, but real sign-in must replace
  `current_user()` before Waypoint leaves a single machine.
- SQLite foreign keys are still not enforced (`PRAGMA foreign_keys` is off): turning them on needs a
  review of every delete path (reset, rewind, source removal) first.
- The gateway cancel call (`POST /v1/runs/{id}/cancel`) is best effort; confirm the Hermes version
  supports it, otherwise an abandoned run still finishes in the background (it can no longer write
  without a live grant).
- Folder tool threat model not written (symlinks, path allowlist, prompt injection via READMEs).
  Protection today = code denylist + prompt rules.
- Portfolio fetch: DNS-rebinding window between the IP check and the request.
- Scanned PDFs fail (no OCR). Arabic transcripts untested for extraction quality.
- Folder evidence cannot tell a student's own repo from a clone except by git remote/authors;
  the student filters it on Review.
- Gemma rungs on the Gemini API cannot call tools, so coach/folder runs that land there fail over.
- No visual diff for proposals; quiz results do not feed the roadmap yet.
- JSON-only runs (CV ingest, quiz, slides, project import) still run on a gateway session that has
  the toolset; student tools are closed to them by the grant check, and team tools need a running
  team run. A real tool-less session type would remove the toolset entirely. Live extraction quality
  is untested (the tests stub Hermes).

## Next steps (in order)
1. Restart (`run.bat` on Windows or `bash run.sh` on macOS) and run the full onboarding live with a real model; fix what breaks.
2. Dry-run a non-CS student (e.g. Medicine with only a CV) and check discipline cards + roadmap shape.
3. Put `HF_TOKEN` in `.env`, restart, confirm a Hugging Face run through the gateway.
4. Replace placeholders (Home/Dashboard) with roadmap progress + recent proposals for the demo.
5. Proposal visual diff in Hermes Coach; feed quiz scores into proposals.
6. Real sign-in (replace `current_user()`), then the folder-tool threat model, then OCR and the
   "coming soon" sources.

## Key files
- Backend: `services/api/app/{main,onboarding,disciplines,hermes,schemas,models,database}.py`,
  `services/api/app/sources/*`
- Staged generation: `services/api/app/pipeline/{profile_step,evidence_step,review_step,brief_step}.py`
  (background collection + readiness gate), `services/api/app/roadmap_gen/{planner,stage,stitch,store}.py`
  (plan → per-stage nodes → wiring check → stitch; sequential default, parallel-safe stage jobs),
  SSE via `GET /api/students/{id}/onboarding/generate/stream`, live canvas in `OnboardingChat.tsx`
  + `src/hooks/use-staged-generation.ts`
- Hermes: `.hermes/plugins/waypoint/{__init__,scanner,tools}.py`,
  `.hermes/skills/{waypoint-onboarding,waypoint-student-coach,waypoint-quiz,waypoint-slides}/SKILL.md`,
  `services/hermes/{SOUL.md,config.yaml}`
- Frontend: `src/components/onboarding/*`, `src/components/hermes/*`, `src/lib/waypoint-api.ts`
- Tests: `services/api/tests/{test_onboarding,test_scanner,test_roadmaps,test_staged_roadmap}.py`

If the card says IAU asked for an extra step, it now shows what IAU displayed ("IAU showed: …") and a
"See what IAU showed" screenshot. To watch the sign-in live, set `WAYPOINT_BB_HEADED=1` in `.env` and restart `run.bat`.
