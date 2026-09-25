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
       +---- Farq project plugin ---- authenticated calls back to FastAPI /internal/hermes
```

HTTP is only the transport into Hermes. `POST /v1/runs` starts the full Hermes agent loop,
including its session, instructions, memory, reasoning, and tool calls. Farq does not import
Hermes internals because its documented gateway contract is a safer upgrade boundary.

## One chat turn

1. The UI saves a message through FastAPI.
2. FastAPI creates an `AgentRun`, supplies the Hermes thread session ID, and sends a unique
   idempotency key to `/v1/runs`.
3. `X-Hermes-Session-Key: farq:user:<id>:<session>` scopes Hermes memory to the current coach session; restoring defaults rotates that session.
4. Hermes may call Farq tools several times before replying.
5. FastAPI polls the durable run and exposes simplified status events to the browser via SSE.
6. The final assistant message and run result are persisted in SQLite.

Failures are stored and shown. The current roadmap is never replaced with fake output.

## Memory ownership

Hermes owns conversational continuity and agent execution. Farq owns verified facts and
decisions. `farq_record_explicit_fact` accepts only direct statements or a branch the student
selected. Reusing a category/key supersedes the old fact without erasing its audit record.

This prevents fuzzy agent memory from becoming the only record of courses, achievements,
strengths, weaknesses, or career direction.

## Onboarding and the first roadmap

A new student is created by `POST /api/students` with an empty v0 roadmap. Onboarding then runs:

1. **Basics**: program text is mapped to a discipline (`app/disciplines.py`) that orders the
   source cards, supplies chat question hints, and gives the generator a stage-shape hint.
2. **Sources** (all optional): transcript/CV/LinkedIn PDFs are text-extracted with `pypdf`,
   redacted (long ID numbers, emails, phones), and turned into evidence by a JSON-only run on a
   throwaway `farq:ingest:*` session. LinkedIn ZIP exports are parsed without a model. GitHub and
   ORCID use their fixed public APIs. A portfolio page is fetched once with SSRF guards. A
   **folder** is indexed by Hermes itself on the student's machine through `farq_scan_folder`
   and `farq_read_project_file`, which submit results with `farq_submit_evidence`.
3. **Review**: every `EvidenceItem` starts `suggested`. The student ticks what is true; ticked
   items become `StudentFact` rows with `source_kind="confirmed_evidence"`, the rest are dismissed.
4. **Chat**: while `onboarding_status == "chat"`, chat turns use `ONBOARDING_INSTRUCTIONS` and
   the `farq-onboarding` skill. Hermes reads `farq_get_student_profile`, asks at most five gap
   questions (ending choice questions with `Options: A | B | C`, rendered as buttons), and records
   answers with `source_kind="onboarding"`. The same thread continues as the coach afterwards.
5. **Generate**: `POST /api/students/{id}/onboarding/generate` builds a deterministic profile
   brief and asks for a whole `RoadmapSnapshot` on a throwaway `farq:roadmap:*` session. The
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
throwaway `farq:quiz:*` session (fresh ID per generation, tools forbidden by
instructions) and polls the durable run in a worker thread, returning the raw
model output. The prompt loads the `farq-quiz` skill
(`.hermes/skills/farq-quiz/SKILL.md`), which carries the question craft the
prompt deliberately does not duplicate: deck-spread coverage with no duplicate
stems, difficulty as the cognitive task rather than the vocabulary, distractors
a half-remembering learner would actually pick, roughly balanced true/false,
and explanations that teach instead of restating the answer. The browser keeps
its parse/salvage pipeline and turns the text into questions. Quiz source text
is never written to SQLite: it is not an explicit student statement, so it must
not become a fact, message, or proposal.

## Slide extension

`POST /api/slides/suggest` and `POST /api/slides/extend` follow the same
pattern on throwaway `farq:slides:*` sessions (tools forbidden, JSON-only
`{"topics": [...]}` / `{"slides": [...]}`). Slide text is never written to
SQLite for the same reason as quizzes. The extend prompt loads the
`farq-slides` skill (`.hermes/skills/farq-slides/SKILL.md`): new slides use
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

## Tool contracts

- `farq_get_student_context(user_id)` reads active verified facts.
- `farq_get_active_roadmap(user_id)` reads the active version, graph, and progress.
- `farq_record_explicit_fact(...)` records a direct statement or explicit choice.
- `farq_submit_roadmap_proposal(...)` validates and stores a pending revision.
- `farq_get_student_profile(user_id)` reads onboarding basics, confirmed evidence and stated facts.
- `farq_scan_folder(path, purpose)` / `farq_read_project_file(path)` index a student-typed local
  folder; secrets, keys and identity documents are refused in code.
- `farq_submit_evidence(user_id, source_id, items)` stores suggested evidence for review.

The plugin calls only `/internal/hermes/*` endpoints with `FARQ_INTERNAL_TOKEN`. It never opens
SQLite. Hermes cannot accept proposals; the student-facing endpoint performs that transaction.

The `farq-student-coach` Hermes skill defines when these tools must be used, how explicit branch
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
