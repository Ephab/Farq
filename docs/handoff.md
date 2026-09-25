# Handoff: onboarding, evidence, first roadmap, model fallback

State as of 2026-09-25. Read this, then `AGENTS.md`, `docs/hermes-architecture.md` and
`docs/future-work.md` before changing this area.

## What was built

### Current Saudi hackathons
- Hackathonat is the primary cached source. FastAPI refreshes its public JSON feed every six hours
  in Docker, preserves the last good cache on failure, and ranks matches without an LLM.
- Hermes can only read matches through `farq_find_hackathons`; generic web/browser tools remain
  disabled. Dates and links in assistant controls and proposals are resolved from SQLite.
- Coach shows an unseen-opportunity badge and sourced cards. Accepted opportunity proposals become
  roadmap nodes with source date, location, registration link, and retrieval provenance.
- The source's `date` is always labelled "Date shown by Hackathonat", never assumed to be a deadline.

### 0. Structured Hermes conversations
- Hermes can append a validated `farq-ui` JSON block to a concise reply. The API removes the
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
   roadmap, a profile and a coach thread. The browser remembers the id (`farq.current-student`
   in localStorage). No auth yet. "Explore the demo student" still works.
2. **Basics** (`BasicsStep.tsx`): university, program, year, graduation. Program text is mapped
   to a discipline by `services/api/app/disciplines.py` (student can override).
3. **Connect** (`SourcesStep.tsx`): every source optional, ordered per discipline:
   transcript PDF, CV PDF, LinkedIn export ZIP, LinkedIn PDF, GitHub, local folder, portfolio
   URL, ORCID. "Coming soon" ideas per discipline are shown but not built.
4. **Review** (`EvidenceReview.tsx`): all imported items are `EvidenceItem(status=suggested)`.
   Ticked items become `StudentFact(source_kind="confirmed_evidence")`; unticked are dismissed.
5. **Chat** (`OnboardingChat.tsx`): Hermes runs with `ONBOARDING_INSTRUCTIONS` + the
   `farq-onboarding` skill, asks ≤5 gap questions, ends choice questions with
   `Options: A | B | C` (rendered as buttons by `ChatThreadView.tsx`), records answers as
   `source_kind="onboarding"` facts.
6. **Generate & preview** (`RoadmapPreview.tsx`): `POST /api/students/{id}/onboarding/generate`
   builds a profile brief and asks Hermes for a full `RoadmapSnapshot`. `validate_generated`
   (`schemas.py`) enforces layout, size and icons, and resets any `done` node that does not cite
   confirmed evidence. Stored as `RoadmapProposal(kind="initial")`; the student unticks
   pre-completed nodes and accepts → v1.

### 2. Adding records later
Sidebar **My data** (`MyDataView.tsx`) reuses Connect + Review (new items only), then hands a
prefilled message to Hermes Coach, which reads `farq_get_student_profile` and submits a normal
future-only proposal. Nothing regenerates from scratch; protected nodes stay protected.

### 3. Evidence sources (`services/api/app/sources/`)
| Source | How | Model? |
|---|---|---|
| Transcript / CV / LinkedIn PDF | `pdf_text.py` (pypdf[crypto], redaction of IDs/emails/phones) → `extract.py` | yes (JSON-only `farq:ingest:*`) |
| LinkedIn ZIP | `linkedin_zip.py` CSV parse | no |
| GitHub | `web.py fetch_github` (public API, optional `GITHUB_TOKEN`) | no |
| ORCID | `web.py fetch_orcid` (public API) | no |
| Portfolio URL | `web.py fetch_page_text` (https only, private-IP/SSRF guard, 1 MB cap) → `extract.py` | yes |
| Local folder | Hermes plugin tool `farq_index_folder` (`.hermes/plugins/farq/scanner.py`) | one tool call |

Uploaded files are never stored. Evidence is deduped by `fingerprint` (git remote, course code, DOI…).

### 4. Folder scanning (Hermes on the student's machine)
`scanner.py` walks a student-typed path, skips dependency trees (any dir with `pyvenv.cfg`,
`node_modules`, `.git`, build dirs), never opens secret-like or identity files (denylist in code),
and maps projects/coursework to evidence deterministically. Real run on a CS student's folders:
34 projects + 29 courses in ~0.6 s. `farq_scan_folder` / `farq_read_project_file` still exist for
deeper inspection but the onboarding prompt uses only `farq_index_folder`.

### 5. Models and fallback (`services/api/app/hermes.py`)
- Providers: Gemini, NVIDIA NIM, Hugging Face (`HF_TOKEN` in server `.env`, provider slug
  `huggingface`, model ids like `deepseek-ai/DeepSeek-V4.1-Flash:deepinfra`).
- Every gateway run (chat, ingest, roadmap, quiz, slides) goes through `execute_with_fallback`:
  any model-side failure (429/quota, 503, failed/cancelled run, empty answer, >120 s) moves to
  the next rung of `FALLBACK_CHAIN`: Gemini 3.8 → 3.7 → 3.6 → 3.5 → 3 → 2.5 Flash → Flash-Lite
  (3.5, 3.1, 2.5) → Gemma 4 → Hugging Face (DeepSeek V4.1 Flash, Gemma 26B novita, gpt-oss-20b,
  Gemma 26B deepinfra, Llama 3.1 8B). Failing models cool down (30 s / 65 s / 30 min for daily quota).
- A 429 on **run creation** is the gateway's own concurrency cap: we wait for a slot, we do not
  skip models. Only a rejected Farq gateway key (401) stops immediately.
- Hermes runtime config (`services/hermes/config.yaml`): `agent.api_max_retries: 1` (Farq does
  the fallback), `tools.tool_search.enabled: "off"` (no discovery round trip),
  `max_concurrent_runs: 8`.
- HF smoke test (tool call + strict JSON, 2026-09-24): DeepSeek V4.1 Flash best (both, ~2 s);
  Gemma 26B novita good; gpt-oss-20b fastest but missed a tool call; Gemma 26B deepinfra slow
  (~30 s); Llama 3.1 8B nscale failed both. Gemma via the Gemini API does not call tools.

### 6. Smaller fixes
- `services/api/tests/conftest.py`: documented pytest command works without PYTHONPATH.
- `scripts/dev.ps1` re-copies config, SOUL, plugin and all skills into `.hermes-runtime` each start.
- `database.ensure_added_columns()` adds new columns to existing SQLite DBs (no migration tool).
- Roadmap header uses the snapshot title; `RoadmapView` refetches on `farq:roadmap-changed`.
- Hermes Coach and onboarding chat share `use-hermes-chat.ts` + `ChatThreadView.tsx`.

## Verification status
- Automated: 64 backend tests (`.venv/Scripts/python -m pytest services/api/tests`) and
  `npm run build` pass.
- Verified live: sign-in, basics, GitHub import (37 repos), transcript/CV/LinkedIn PDF/portfolio
  extraction, scanner on real folders, Gemini Flash-Lite through the gateway.
- **Not yet verified live end to end:** folder indexing via `farq_index_folder` after the
  restart, the onboarding chat, roadmap generation + preview + accept, My data → Hermes
  proposal, Hugging Face through the gateway (the running gateway lacked `HF_TOKEN`).

## Known gaps
- No authentication; any client can act as any student id. `POST /api/settings/hermes` writes
  `.env` unauthenticated.
- Folder tool threat model not written (symlinks, path allowlist, prompt injection via READMEs).
  Protection today = code denylist + prompt rules.
- Portfolio fetch: DNS-rebinding window between the IP check and the request.
- Scanned PDFs fail (no OCR). Arabic transcripts untested for extraction quality.
- Folder evidence cannot tell a student's own repo from a clone except by git remote/authors;
  the student filters it on Review.
- Gemma rungs on the Gemini API cannot call tools, so coach/folder runs that land there fail over.
- Existing quiz/slides frontends still show their own model labels; fallback happens server-side.
- UI brand says "SmartLearn"; product is "Farq". Home, Dashboard, Projects are placeholders.
- No visual diff for proposals; quiz results do not feed the roadmap yet.

## Next steps (in order)
1. Restart (`scripts/dev.ps1`) and run the full onboarding live with a real model; fix what breaks.
2. Dry-run a non-CS student (e.g. Medicine with only a CV) and check discipline cards + roadmap shape.
3. Put `HF_TOKEN` in `.env`, restart, confirm a Hugging Face run through the gateway.
4. Replace placeholders (Home/Dashboard) with roadmap progress + recent proposals for the demo.
5. Proposal visual diff in Hermes Coach; feed quiz scores into proposals.
6. Auth, then the folder-tool threat model, then OCR and the "coming soon" sources.

## Key files
- Backend: `services/api/app/{main,onboarding,disciplines,hermes,schemas,models,database}.py`,
  `services/api/app/sources/*`
- Hermes: `.hermes/plugins/farq/{__init__,scanner,tools}.py`,
  `.hermes/skills/farq-onboarding/SKILL.md`, `services/hermes/{SOUL.md,config.yaml}`
- Frontend: `src/components/onboarding/*`, `src/components/hermes/*`, `src/lib/farq-api.ts`
- Tests: `services/api/tests/{test_onboarding,test_scanner,test_roadmaps}.py`
