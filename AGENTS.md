# Farq developer context

Farq is a React/Vite student app with a FastAPI/SQLite product backend and a local Hermes
Agent gateway. The browser never calls Hermes or Gemini directly.

## Invariants

- SQLite is the authoritative student and roadmap store; Hermes memory is supplemental.
- Hermes uses the project plugin in `.hermes/plugins/farq` to interact with the app.
- Only explicit student statements, branch choices, onboarding answers, and evidence the student
  ticked on the review screen become `StudentFact` records (`source_kind` records which).
- Imported evidence (transcript, CV, LinkedIn, GitHub, folders, portfolio, ORCID) is stored as
  `EvidenceItem` rows in `suggested` state and never becomes a fact without that review.
- Hermes creates roadmap proposals, including the generated first roadmap (`kind="initial"`).
  Only the FastAPI acceptance endpoint activates them.
- Completed and in-progress nodes cannot be changed or removed by a proposal.
- Do not enable terminal, generic file, browser, or web tools until their threat model is documented.
  The one exception is the onboarding folder scan (`farq_scan_folder`, `farq_read_project_file`):
  Hermes runs on the student's machine and reads only paths the student typed. Its secret and
  identity-document denylist is enforced in `.hermes/plugins/farq/scanner.py`, not only the prompt.
  A full threat model for it is still owed (see `docs/future-work.md`).
- Uploaded files are never stored; only redacted, extracted evidence is.
- Keep Gemini and Hermes keys server-side.

## Commands

- Native setup: `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`
- Native run: `powershell -ExecutionPolicy Bypass -File scripts/dev.ps1`
- Reproducible run: `docker compose up --build`
- Frontend check: `npm run build`
- Backend tests: `.venv/Scripts/python -m pytest services/api/tests` (also covers the plugin scanner)
- Regenerate the backend roadmap seed after editing the TypeScript seed: `node scripts/export-roadmap.mjs`

Read `docs/handoff.md` (current state, gaps, next steps), `docs/hermes-architecture.md` and
`docs/future-work.md` before extending agent access.

