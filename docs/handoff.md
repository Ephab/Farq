# Handoff: project state

## Collaboration service foundation (2026-10-03 worktree)

The approved [execution plan](superpowers/plans/2026-10-03-collaboration-service.md)
keeps personal Waypoint local and introduces an optional centrally deployed service
in `services/collaboration/`. Architecture and threat-model documents define silent
device accounts, separate PostgreSQL, reviewed shared profiles, peer classes,
both matching modes and isolated team Hermes. The service foundation implements
configuration isolation, explicit account migration, health and bearer-authenticated
`/v1/me`; a standalone TypeScript client is in `packages/collaboration-client/`.
The device-key broker (OS-vault key, silent registration, short-lived tokens) is implemented in
`packages/collaboration-auth`, mounted by the personal API. Run the server on its own with `server.bat`
([guide](running-the-shared-server.md)). Human team routes are
ported to the central database behind `COLLAB_TEAMS_ENABLED`; the frontend selects
them (team Hermes runs on its own gateway, `server.bat start --team-ai`) when `WAYPOINT_COLLAB_URL` is set and the student has confirmed the connection once (a pane in Group Projects; the choice is kept in the OS vault and enforced by the local API). The service flag defaults off. Native PostgreSQL
checks pass, including two-account room sharing and access revocation. Peer classes, assignments, expiring class/project codes, persistent
redemption quotas, class member removal and project lead transfer are now available
under the same pilot flags (schema `0003_classes`). Organizers have no instructor
privileges. Class-scoped team openings and explicit lead-approved join requests
are now implemented (schema `0004_openings`), with expiry, quotas, cancellation and
concurrent seat checks. Real two-account class-to-opening-to-team integration passes.
Class ownership transfer and reversible class/project archives are implemented
(schema `0005_lifecycle`). Archives suspend access, preserve history and close
invitations/openings/requests without reviving them on restore. Original creator
identity preserves quotas through transfers. See the service README for setup.
Class-scoped reviewed profile publication/withdrawal and private matching preferences
are now implemented (schema `0006_profiles`). The deterministic `fit-v1` matcher
returns bounded whole-team combinations with concrete factors and missing data;
candidate reads recheck consent/version. Removal/archive clears profiles, and team
membership never publishes them. Real provider coverage includes matching and stale
reads after withdrawal. Separately reviewed team summaries and existing-team opening
matching are now implemented (schema `0007_team_profiles`). Team sharing does not
imply class discovery; each member opts in separately. Missing summaries remain
unknown and cannot satisfy hard availability/language constraints. Match-based join
requests recheck consent, membership, opening and preferences atomically. Removal
and archives clear shared team bodies without republishing on restore. Latest
checks: 63 service/PostgreSQL, 7 auth/live-provider and 39 frontend tests; build passes.
Coach isolation/bridge, legacy-data import and release packaging remain next work; this is not a production-ready collaboration release.

State as of 2026-10-03 (native QA evaluator follow-up on `main`). Read this, then `AGENTS.md`,
`docs/hermes-architecture.md` and `docs/future-work.md` before changing an area.

## Current state at a glance

| Area | State | Section |
|---|---|---|
| Onboarding → evidence review → first roadmap | Built; staged generation; live end-to-end run still owed | 1–4 |
| Roadmap view, proposals, history | Built | Roadmap view |
| Hermes Coach chat | Built; rich elements (quiz, timer, flashcards…), animated progress, no model/reasoning leak | 0, 5a-3 |
| Co-op | Rebuilt 2026-10-03: extraction + per-student Jev relevance, gaps → roadmap proposal | Co-op |
| CV builder (Career > CV) | New 2026-10-03: generate from confirmed data, drafts, Ask Hermes edits, fit, PDF | CV builder |
| Group Projects | Built (plans 1–3); Plan 4 (animations, Playwright demo) open; user bug report pending | Group Projects |
| Projects + evaluator | Native QA agent verified; screenshot-based VLM review is the next step | Project milestones |
| Quizzes / Slides | Built (separate tool-less JSON prompts) | — |
| Outlook, Blackboard demo, hackathons | Built | respective sections |
| Memory / skills / connectors | Built; "Hermes self-adapting" (learned skills) under-used, see Next steps | 5a |
| Jev decision layer | Jev is the active engine on the dev machine (`decision_engine=jev` in Settings) | below |

**Run it:** `setup.bat` then `run.bat` (Windows), `bash setup.sh` / `bash run.sh` (macOS). Docker is
optional and not needed for development. API :8000, Hermes gateway :8642, Vite :5173 (proxies
`/api`). If `uv` fails on C: with "os error 17" (a rename error), set `UV_PYTHON_INSTALL_DIR` and
`UV_CACHE_DIR` to a folder on another drive for both setup and run; `run.bat` then needs the same
variables, or it reports the Hermes launcher as broken.

**Dev-only previews (Vite dev server only, fixtures, no network):** `?mock=elements` (Hermes Coach:
every chat element plus the loader), `?mock=coop&persona=cs|medicine` (Co-op), `?mock=cv&persona=cs|medicine` (CV).
Open the URL, then pick the view in the sidebar.

**Phone access while developing:** `cloudflared tunnel --url http://127.0.0.1:5173 --http-host-header 127.0.0.1:5173`
needs `server.allowedHosts: ['.trycloudflare.com']` in `vite.config.ts`. That setting is checked in for phone-preview access. A quick tunnel dies when the laptop sleeps or loses network, and the URL changes
on every restart.

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
- The Jev key variable is `TYPESAFE_AI_API_KEY`; `TYPESAFE_API_KEY` is silently ignored. With the
  wrong name and `auto` mode, every decision falls through to local Laya, which pinned the CPU at
  ~700% on the dev laptop.
- Purposes that call `decision_engines.ask_chain` directly (they skip the shadow gate):
  `coop_relevance` (`app/coop_relevance.py`) and `cv_fit` (`app/cv_fit.py`). Both have
  deterministic fallbacks for when every engine is unavailable.
- Tests never load the real Laya model. `services/api/tests/conftest.py` makes it unavailable,
  because otherwise app startup in tests (Blackboard seeding observes items) fell through to Laya
  and made a run take 20+ minutes. A test that needs Laya installs a fake with
  `monkeypatch.setitem(decision_engines.INFO/ASK, "laya", ...)`.

## Blackboard live sync (2026-10-03)

- Session notice / missing lectures follow-up: sync acknowledges only the exact IAU
  "Additional device logged out" Continue dialog, then checks the authenticated API. AD FS silent
  redirects are handled while waiting for the login form; they never verify a typed password.
  The extractor reads Ultra `data-bbfile` metadata for embedded files with opaque WebDAV URLs.
  A live metadata-only sync succeeded and recovered NLP lectures 1–4 alongside 5–6, plus Ethics
  lecture 1 and its updated version alongside 3–4. Originals remain remote until opened.
  Newly catalogued NLP lecture 1 and updated Ethics lecture 1 both downloaded successfully
  into memory with verified PDF signatures (2,140,195 and 1,043,322 bytes); nothing saved to disk.
  Slides has subject folders and lecture/assignment/course-information/other-document filters,
  plus term, format and search. Classification uses filenames and Blackboard paths.
  Placeholder `ultraDocumentBody` titles display the filename in cards and collected records.
  "Load previews on screen" snapshots the visible cards and loads PDF/PPTX first-slide covers
  sequentially into memory; scrolling never triggers downloads. Stop, navigation and filter
  changes cancel the batch. Desktop English and mobile Arabic browser checks verify viewport
  scope, rendered covers and placeholder replacement.
- Collection follow-up: My Data > Blackboard > View collected data exposes every stored course,
  materials/announcements/assessments, grades, remote files, calendar events, diagnostics and a
  redacted full export. The card now distinguishes **all courses** from current courses (the
  student's observed 16 was the current count; their last sync listed 62 total).
  Slides lists remote PDF/PPT/PPTX files by course and term with covers, in-memory previews on open,
  optional workbench import and explicit Save to device. The catalog needs a new sync: older runs
  discarded attachment metadata. Originals are not cached on disk. Owner-only, connector-gated
  downloads use the saved session and enforce HTTPS redirects to IAU or its exact verified
  file tenant (`alt-685da65a9aa3e.blackboard.com`), plus the 15 MB limit. The tenant receives a
  separate request context with no IAU login cookies. A real-account PDF download (830,308 bytes,
  verified PDF signature) and PPTX download (8,671,187 bytes, verified presentation archive)
  succeeded through the IAU → storage redirect without storing the files.
- Term IDs, names, dates and classification reasons are retained. Term dates override availability,
  enrollment and year hints; statuses are current/past/upcoming/completed/unknown. A gradebook total
  no longer proves completion. Missing dates are unknown. Attachment discovery no longer stops at
  80 content items, follows attachment pagination, and catalogs observed same-origin document links.
  Pagination caps are marked partial; filtered/failed course listings cannot delete past courses.
  Backend/extension and browser fixture checks cover these flows; live sync and representative
  ordinary and embedded-file downloads have also been verified.

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
**Matches tab (rebuilt 2026-10-03).** The default "For you" tab used to show the same 8 checked-in
companies to every student. Only the order changed, and Jev never saw the student. It now shows
real postings scored per student:
- **Extraction** (`app/coop_extraction.py`): one tool-less JSON prompt per posting, cached on
  `CoopPosting.extracted_json` / `extraction_status`, never re-run once done. It extracts:
  - a clean title and company
  - target disciplines and seniority
  - skill requirements, quoted from the text and never invented
  - eligibility requirements (GPA, nationality, enrollment, university letter, language test), each flagged `learnable`
  - location, duration, and the apply window, with Arabic dates parsed

  Posting text is untrusted data.
- **Relevance** (`app/coop_relevance.py`, table `coop_relevance`): one row per student × posting.
  - **Jev input:** discipline, program and confirmed skills against the extracted fields. Jev returns relevant/fit.
  - **Guards** (`_discipline_guard`): a posting whose target majors exclude the student's is hidden.
    Adjacent majors (cs↔engineering, sciences↔medicine) are capped at 60. Broad "any major, soft
    skills only" programs are capped at 70. Manager and senior roles are always hidden.
  - **Fallback:** a discipline-aware heuristic when the whole chain fails.
  - **Caching:** rows are keyed by fingerprints of the student state, the extracted posting and
    `SCORING_VERSION`. Bump the version to re-score everyone after changing the rules.
- **Gaps:** only requirements the posting actually states. Each gap carries `skill`, `why` (the
  quoted requirement), `importance`, `evidence_needed` and `suggestion {title, description, duration,
  kind}`. Eligibility-only postings (e.g. Aramco's) show no skill gap, only an eligibility checklist.
- **Add to roadmap** (`POST .../coop/postings/{id}/propose-gaps`) builds one `RoadmapProposal`
  (`kind="coop_gaps"`) of `add_node` operations from the selected gaps. It never activates; the
  student accepts it at the existing proposal endpoint.
- **`GET .../coop/matches`** returns visible and hidden-with-reason lists. It never waits on a model:
  per-request budgets are 0, and one background pass per student scores the rest, committing per
  posting so SQLite's write lock is never held across a model call. The UI refetches every 8 s while
  any entry is `engine="unscored"`.
- **Display names:** `_display_company` prefers the extracted company, rejects scraper junk
  (sentences, section labels, `company-<hex>` slugs) and shows LinkedIn slugs as words. An empty
  name renders as "Employer not named".
- **UI** (`src/components/coop/CoopMatchesPreview.tsx`, embedded in `CoopView.tsx`):
  - Each card shows the source badge, fit bar, "why it fits" line and target majors (the student's own major first).
  - A black chip at the card's bottom-start shows the top missing skill.
  - The detail sheet lists matched skills, gaps with per-gap or "Add all" roadmap actions, the eligibility checklist and "Tailor my CV for this".
  - Other parts: a "Hidden as not relevant (N)" collapsible, a sources strip, and a plain Companies directory tab.
  - The Openings, Saved and Hidden tabs and search still use the older code path.
- Demo companies/postings are shown only when no real posting exists anywhere.
- LinkedIn (Apify actor `hKByXkMQaC5Qt9UMN`) failed every run with HTTP 400 until 2026-10-03:
  `datePosted` must be `"pastMonth"`, not `"past month"`.

**Older description (catalog, sources, refresh) — still accurate unless contradicted above:**
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

### CV builder (Career > CV, 2026-10-03)
- **UI** (`src/components/cv/`):
  - An editor sits beside a live A4 preview (stacked on phones).
  - Three templates: Classic, Modern, and Compact (two columns).
  - Appearance: 8 accent presets plus a custom color, and a sans/serif choice.
  - Contact fields are optional and omitted from the CV when empty.
  - Sections can be shown/hidden, dragged to reorder and edited inline. Each bullet has a provenance chip, hidden in print.
  - **Download PDF** uses `window.print` on an isolated `.cv-print-root` with `@page A4`. DOCX was
    skipped because no library is installed.
- **Backend** (`app/cv.py`, table `cv_drafts`, all routes owner-checked):
  - `POST .../cv/generate` (optional `posting_id` to tailor): a tool-less JSON prompt fed confirmed
    data only — profile brief, completed roadmap nodes, projects + evaluations, Group Projects task
    contributions, reviewed evidence. It gets one repair retry, and provenance labels must reference real records.
  - `GET/PUT .../cv/draft` stores the edited document, including theme and order. It never becomes a StudentFact.
  - `POST .../cv/assist` is **Ask Hermes**. It returns at most 4 field-level changes; target ids are
    regex-whitelisted and the server computes the before-values. The student accepts or undoes each change.
  - `POST .../cv/fit`: Jev fit against a co-op posting (`cv_fit.py`, with a keyword fallback).
- "Tailor my CV for this" on a co-op detail sheet stores the posting id in sessionStorage
  (`waypoint.cv.tailor-posting`) and opens CV, which runs the tailored generate + fit once.
- Generation takes ~60 s on the current model. The name defaults from the profile, so a student
  with no confirmed name sees their program as the name until they type theirs.

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
**Current limit / next step:** captured screenshots are evidence for the student; no VLM currently reviews their pixels. Implement screenshot-based VLM review next (see Next steps).

- Staged generation now labels stage types and requires one final project for each new
  `skill_sequence`; legacy plans without stage types remain readable.
- Roadmap project nodes materialize into persistent briefs with weighted rubrics, explicit draft
  acceptance, submissions, evaluation attempts, latest/best scores and completion history.
- Firas's Projects view is extended into Brief, Refine, Submit and Evaluations workspaces. Project
  nodes open it on double-click/right-click; normal nodes keep their completion shortcut.
- Hermes has bounded `waypoint_get_project` / `waypoint_submit_project_refinement` tools and a
  `waypoint-project-coach` skill. Drafts never apply themselves.
- Native run scripts start the authenticated evaluator automatically; `scripts/evaluator.ps1` also starts it standalone. It accepts GitHub, ZIP and local-directory snapshots. Native execution for trusted local directories is enabled with `WAYPOINT_EVALUATOR_NATIVE=1` (authorized on this machine). A JSON-only QA agent chooses typed native CLI/test, local HTTP and Playwright browser checks, then writes an evidence-cited rubric review. Logs, limitations and desktop/mobile screenshots appear in Evaluations. No Docker is required; ZIP/GitHub execution is refused without a sandbox. See `docs/evaluator-threat-model.md`. Setup installs the evaluator Chromium browser. The Windows runner also recovers stale uv Hermes trampolines read-only using a matching managed Python under `UV_PYTHON_INSTALL_DIR`.
- Evaluation progress is available through SSE and the workspace poller. Each check is saved before further model reasoning, so failures preserve evidence. Final review must echo the exact accepted scope, cite actual check IDs and cover every rubric criterion; the server computes the weighted score. A completed evaluation marks the milestone done at any score.
- Live verification (2026-10-03): `VLM-System2` CLI unit tests/demo/schema and independent probes ran natively. The probe exposed numeric-substring and negated-answer false positives in the submitted harness; its accepted project received 82/100 with medium coverage and explicit HF/Docker limitations. A separate local web fixture passed POST and desktop/mobile form workflows with two screenshots; the real Waypoint report UI was captured and had no page errors.
- Backend test isolation: `conftest.py` selects a temporary database before importing `decision_engines`, which otherwise imports the database before individual test modules select their `TEST_DB`. Test runs never write the real student store.

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

### 5a-3. Chat elements, progress UX, no leaks (2026-10-03)
- **Elements:** Hermes calls `waypoint_show_element` (plugin), which posts to
  `POST /internal/hermes/elements` (`app/chat_ui.py`). The element is staged into the caller's own
  running `AgentRun.ui_json` under the ask grant, and `merge_staged_ui` attaches it to the reply.
  - Kinds (a Pydantic discriminated union in `schemas.py`, mirrored in `src/components/hermes/elements/types.ts`; keep the limits in sync):
    - `quiz` (≤10 questions; mcq, true/false or short answer; optional per-question timer)
    - `timer`, `progress`
    - `flashcards` (≤20), `checklist` (≤15)
    - `table` (≤6×20), `callout`, `code` (≤4000 chars)
  - At most 6 elements per reply.
  - Quiz answers stay in the browser and never become facts or evidence.
- **Quizzes in chat:** the coach is told to use the quiz element. A reply that is still a bare or
  fenced `{"questions": [...]}` is converted to a quiz element by `parse_chat_output`; other JSON is
  fenced as code. No model repair retry was added. The separate `/api/quiz` feature (`quiz.py`) is
  unchanged.
- **Rendering:** `ChatElementView.tsx` and `views/*` render the elements. Code blocks use
  highlight.js (`parts/highlight.ts`, common languages, auto-detect) with theme tokens in
  `coach-concept.css`. `markdown.tsx` renders fenced code blocks and pipe tables.
- **Loader:** `CoachLoader.tsx` shows an animated orb with short step titles that cross-fade, keyed
  by tool name (`TOOL_KEYS` in `RunProgress.tsx`, i18n `coach.progress.tools.*`). New assistant
  replies reveal word by word. Reduced-motion is respected.
- **No leaks, enforced server-side:** `_live_progress` (`main.py`) nulls `model`, `tokens`, `tps`,
  `preview` and `notice`. `AgentRun.stage` is only the label (it used to append the model name,
  which the app header showed). Raw interim/reasoning text never reaches the student.

### 5b. Speed profile (2026-10-02)
- Coach turn: was ~3.5 min (Gemini 503 + Hermes auto-recovery sleeps + a title call + a retry on the
  same session) and later 75 s on NIM with 8 model calls (the fact tool was called up to 5x per fact).
  `waypoint_record_explicit_fact` is now idempotent and says "stored, do not repeat"; a turn is ~3 calls
  with ~1.3 s of Waypoint/gateway overhead. The rest is the model: Nemotron Ultra ~11 tok/s (~80 s per
  reply), Super ~9-20 s, Gemini Flash a few seconds.
- JSON features: ~1-3 s overhead on the gateway; quiz on Ultra 35 s, Super 20 s, Gemini direct ~9 s.
- `useActiveRun` polls every 2 s only while a run is live (15 s idle, instant on send/visibility).

### 6. Smaller fixes
- Coach runs never reach for the onboarding Generate button. `waypoint_ready_to_generate` is refused
  outside the onboarding chat (409), but only a run's final text is stored and shown, so the refusal
  used to *replace* Hermes' answer: a student asked "Where do I start coding?" and got "I couldn't
  show the Generate button from here (it's onboarding-only)…" instead. `COACH_INSTRUCTIONS` now
  forbids the call and points the coach at `waypoint_get_active_roadmap`, the 409 detail tells the
  model to answer the question rather than narrate the error, and the plugin tool description says
  the same (2026-10-03).
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

- Native evaluator follow-up (2026-10-03): **509 backend tests passed**, frontend build passed; real CLI evaluation completed, HTTP/browser form flow and desktop/mobile screenshots verified, and the completed Waypoint report UI had no page errors. Visual screenshot grading has not been implemented or verified.
- **Automated (2026-10-03):** 492 backend tests (~60 s), `npm run build` and 70 Vitest tests pass.
  Test modules share one SQLite file in a full run (the engine binds to the first `DATABASE_URL`
  set at collection), so use unique titles and ids in test data.
- **Verified live 2026-10-03 (Windows, native run, Jev active):**
  - Chat: "quiz me on probability, 3 questions" returned a 3-question quiz element and no JSON (~18 s).
  - Co-op: real LinkedIn (16) and Telegram (18) postings; 59 postings scored per student; matches load in ~0.3–0.6 s.
  - CV: generate from real data (~57 s) and the draft round-trip work.
- **Not verified live:**
  - CV Ask Hermes and tailoring against a real posting.
  - Co-op "Add to roadmap" accepted end to end in the Roadmap view.
  - Arabic UI for the new screens.
- Older (2026-10-01): 395 backend tests (`.venv/Scripts/python -m pytest services/api/tests`),
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
- **Co-op:**
  - The Telegram scraper still splits some posts badly. Raw titles and companies can be junk; the
    extraction and display layer hides most of it, but `coop_sources.py` parsing itself is untouched.
  - Duplicate LinkedIn listings (e.g. two "DataOps Intern" at Tabby) are not merged.
  - The Openings, Saved and Hidden tabs still use the older token-overlap ranking.
- **Chat:** no model repair retry for malformed element JSON; the deterministic conversion covers quizzes only.
- **CV:**
  - DOCX export is not built.
  - Generation is slow (~60 s) and runs in the request.
  - The Ask Hermes free text is handled by the real prompt, but only the dev mock is keyword-routed.
- `JEV_MODE` stays `shadow` for the generic `observe/rerank` purposes. `coop_relevance` and
  `cv_fit` act directly (see the Jev section); neither has a labeled evaluation set yet.
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

1. **Project evaluator: screenshot-based VLM review.** Screenshots are captured today, but the reviewer only receives source context, DOM text, logs and test results; it does **not** inspect screenshot pixels. Next, send the captured desktop/mobile PNGs to a server-selected vision-capable model, combine its visual findings with runtime evidence, and show screenshot-cited feedback for UI behavior, layout, usability and accessibility. Keep model/provider selection and keys server-side, preserve ownership and lease checks, and update `docs/evaluator-threat-model.md` for image disclosure and image-based prompt injection. Validate with labeled visual defects and a live web-project evaluation. CLI-only projects such as `VLM-System2` have no UI and should continue to receive behavior-based CLI review.
2. Remaining user test reports (2026-10-03): **Group Projects** and **Hermes
   self-adapting**. Project evaluation now runs natively; visual VLM review is step 1. Learned skills via `skill_manage` exist but are barely used: decide when Hermes
   should write a skill, and show it to the student. Chat and co-op fixes from the same round are done.
3. Restart (`run.bat` on Windows or `bash run.sh` on macOS) and run the full onboarding live with a real model; fix what breaks.
4. Dry-run a non-CS student (e.g. Medicine with only a CV) and check discipline cards + roadmap shape.
5. Put `HF_TOKEN` in `.env`, restart, confirm a Hugging Face run through the gateway.
6. Replace placeholders (Home/Dashboard) with roadmap progress + recent proposals for the demo.
7. Proposal visual diff in Hermes Coach; feed quiz scores into proposals.
8. Real sign-in (replace `current_user()`), then the folder-tool threat model, then OCR and the
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
- Chat elements: `src/components/hermes/{elements/*,CoachLoader,RunProgress,markdown,MockElementsThread}.tsx`,
  `services/api/app/{chat_ui,schemas}.py` (`ChatElement`), plugin tool `waypoint_show_element`
- Co-op: `services/api/app/{coop,coop_extraction,coop_relevance,coop_sources,coop_refresh}.py`,
  `src/components/coop/{CoopView,CoopMatchesPreview,fixtures}.tsx`
- CV: `services/api/app/{cv,cv_fit}.py`, `src/components/cv/*`, `src/locales/{en,ar}/cv.ts`
- Tests: `services/api/tests/{test_onboarding,test_scanner,test_roadmaps,test_staged_roadmap,test_coop_phase_b,test_cv,test_hermes_settings}.py`

If the card says IAU asked for an extra step, it now shows what IAU displayed ("IAU showed: …") and a
"See what IAU showed" screenshot. To watch the sign-in live, set `WAYPOINT_BB_HEADED=1` in `.env` and restart `run.bat`.

## Learning updates (2026-10-04)

Implemented Learning updates navigation, English/Arabic topic confirmation, source filters, cache
cards, private dismissals and Ask Hermes. Backend learning_updates/ owns SQLite records, curated
source validation, owner-checked routes, running student READ tools, separate Reddit/X connector
switches and durable six-hour Apify refresh queue with $1/day shared budget and $0.10 reservations.
Paid refresh defaults off behind two rollout flags; no live verification is claimed. See
[learning-updates-threat-model.md](learning-updates-threat-model.md) for rollout and lost-launch recovery.

Verification: full backend suite **553 passed** (41 new learning-update cases); frontend **70 passed**;
`npm run build` passed. `node scripts/check-learning-updates.mjs` passed English desktop and Arabic
mobile confirmation/filter/dismissal/Ask Hermes flows with escaped injection text. The browser test
uses mocked API data, not live scraping. Existing lint/build/deprecation warnings remain.
