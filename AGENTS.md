# Farq developer context

Farq is a React/Vite student app with a FastAPI/SQLite product backend and a local Hermes
Agent gateway. The browser never calls Hermes or Gemini directly.

## Invariants

- SQLite is the authoritative student and roadmap store; Hermes memory is supplemental.
- Hermes uses the project plugin in `.hermes/plugins/farq` to interact with the app.
- Only explicit student statements and branch choices become `StudentFact` records.
- Hermes creates roadmap proposals. Only the FastAPI acceptance endpoint activates them.
- Completed and in-progress nodes cannot be changed or removed by a proposal.
- Do not enable terminal, file, browser, or web tools until their threat model is documented.
- Keep Gemini and Hermes keys server-side.

## Commands

- Native setup: `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`
- Native run: `powershell -ExecutionPolicy Bypass -File scripts/dev.ps1`
- Reproducible run: `docker compose up --build`
- Frontend check: `npm run build`
- Backend tests: `.venv/Scripts/python -m pytest services/api/tests`
- Regenerate the backend roadmap seed after editing the TypeScript seed: `node scripts/export-roadmap.mjs`

Read `docs/hermes-architecture.md` and `docs/future-work.md` before extending agent access.

