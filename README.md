# Farq

Farq is a student learning platform with an adaptive roadmap, quizzes, and a persistent
Hermes Agent coach. Hermes runs locally as an agent service; Gemini supplies its current
reasoning model. FastAPI and SQLite keep the auditable product state.

## What works

- Existing Computer Vision roadmap and quiz experience.
- Persistent roadmap progress and immutable structural versions.
- Dedicated Hermes Coach with persistent chat and live run status.
- Student memory learned from explicit chat statements and branch choices.
- Hermes tools for reading context, reading the roadmap, recording facts, and proposing revisions.
- Reviewable roadmap diffs with accept/reject controls.
- Validation that protects completed/in-progress work and prevents invalid dependency graphs.

## Start with Docker

1. Copy `.env.example` to `.env` and add `GEMINI_API_KEY`.
2. Ensure Docker Desktop is running.
3. Run:

```powershell
docker compose up --build
```

Open `http://127.0.0.1:5173`. FastAPI docs are at `http://127.0.0.1:8000/docs`
and Hermes health is at `http://127.0.0.1:8642/health`.

## Start natively on Windows

Install Node.js, Python 3.12+, and Hermes Agent, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
# Add GEMINI_API_KEY to .env
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
```

The script runs FastAPI and Hermes in the background and Vite in the foreground. Hermes
uses `.hermes-runtime` as its isolated local profile and loads the checked-in Farq plugin.
Press Ctrl+C to stop Vite and clean up the FastAPI and Hermes process trees started by
that script. Allow cleanup to finish before closing the terminal; forcibly ending the
PowerShell process bypasses its cleanup.

## Verify

```powershell
npm run build
.venv\Scripts\python.exe -m pytest services\api\tests
```

If Hermes or Gemini is unavailable, the roadmap remains usable and chat displays the actual
failure. There is intentionally no canned AI fallback.

See [the Hermes architecture](docs/hermes-architecture.md) and
[future work](docs/future-work.md) before extending the agent.
