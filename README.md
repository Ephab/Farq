# Waypoint

Waypoint is a React/Vite student app with a FastAPI/SQLite backend, a local Hermes
Agent gateway, and local Laya email classification. It includes learning roadmaps,
quizzes, slides, reviewed evidence, group projects and a private email workspace.
SQLite owns product state; AI suggestions never silently become student facts or
accepted roadmap changes.

## The education problems Waypoint addresses

- **Students feel lost:** an adaptive roadmap turns their courses, goals, progress, and available
  time into a clear next step while keeping future branches flexible.
- **Curricula fall behind industry:** academic foundations are connected to current tools, projects,
  soft skills, hackathons, and co-op opportunities.
- **Students become dependent on AI:** Hermes acts as a coach and group teammate that teaches,
  proposes, and asks for approval instead of silently doing the student's work.
- **Career preparation starts too late:** project evidence and demonstrated skills feed personalized
  Saudi company matches and preparation-gap guidance.

See [the complete problem–solution overview](docs/problem-solution.md).

## Windows

Install [Node.js LTS](https://nodejs.org/) and Git, clone the repository, then run:

```bat
setup.bat
run.bat
```

## macOS

Install Node.js LTS and Git, clone the repository, then run:

```sh
bash setup.sh
bash run.sh
```

Open **http://localhost:5173**. Stop the native runner with Ctrl+C to stop its own
API, web server and shared Coach/email gateway. Do not run both platform
runners or another Waypoint instance on the same ports.

## What setup does

- Installs uv if missing and manages Python 3.12.
- Installs the locked dependencies from `pyproject.toml` and `uv.lock`, plus frontend
  packages from `package-lock.json`.
- Checks Hermes, uses its [official installer](https://hermes-agent.nousresearch.com/docs/getting-started/installation)
  if missing, and verifies the CLI. It preserves your existing Hermes installation.
- Downloads/caches the pinned Laya model and runs a synthetic classification check.
  Runtime selects CUDA → MPS → CPU; no training or manual model download is needed.
- Creates/updates `.env`, generating missing `HERMES_API_KEY`, `WAYPOINT_INTERNAL_TOKEN`
  and `WAYPOINT_TOKEN_ENCRYPTION_KEY`. Existing valid secrets/provider keys are preserved.
- Detects classic Outlook without opening it and generates `OUTLOOK_LOCAL_TOKEN`
  only on supported Windows devices. No email is read during setup.
- Provisions Waypoint's `.hermes-runtime` profile for Coach and email Q&A.

First setup needs internet and several GB of disk/RAM; later runs reuse package and
model caches. Node.js, Git, GPU drivers and any OS-level installer prerequisites
must be available. Hermes installer failures stop setup with their error. Laya
supports Intel Mac CPU inference, but Hermes support must also pass on that machine.

For Hermes answers, add your own `GEMINI_API_KEY`, `NVIDIA_API_KEY` or `HF_TOKEN` to
`.env` and choose the matching provider in Settings. Setup generates **local service
secrets**, not third-party AI credentials or Microsoft access tokens. Laya email
classification works locally without an AI-provider key. Model weights, `.venv`,
`.env` and runtime state are ignored by Git.

## Email: two methods only

**Classic Outlook (Windows):** open classic Outlook with the desired default mailbox.
In **Emails**, check **I allow Waypoint to read and locally classify my classic Outlook
mailbox**. No pairing code, copied token or app registration is required. Outlook's
own security prompts and organizational policy still apply. New Outlook, Outlook
for Mac and Docker do not support this COM method.

**Temporary Microsoft Graph token (Windows/macOS/Docker):** paste an already-issued
token with User.Read and Mail.Read consent, then accept access. Waypoint encrypts it on
the server. It cannot refresh; reconnect with a new token when it expires. Setup
cannot mint this token or bypass Microsoft consent. Entra popup and device-code
sign-in methods have been removed.

Both methods feed one inbox: Important, Today, Needs review, Follow-ups, search,
full cleaned message text and batch tools. Home shows today's email in a side
column. Mail is read-only; no sending, deleting, mark-as-read, calendars or attachments.
Laya labels are suggestions, and Arabic messages require manual review. Cache
retention is 30 days; disconnect clears Waypoint's cached mail.

Selected-email Q&A requires explicit consent to send those messages to the configured
AI providers (including fallback providers). It runs through the same Hermes gateway as Coach at port 8642, sharing its tools
and memory. Enable **Allow Coach to search and read my synced emails** in Emails
to also use mailbox search from Coach chat. This consent is per browser session;
turn it off or disconnect to revoke future access. Gateway/provider transcripts
may outlive the local cache. See [Outlook setup](docs/outlook-setup.md),
[privacy boundaries](docs/outlook-threat-model.md), and [Laya details](docs/local-email-classifier.md).

## Group Projects with friends (shared server)

Group Projects works on your own computer by default. To work with friends on different computers, one person runs the
**shared server**, a separate program that can be started and stopped on its own, and everyone points their app at it.
There is no sign-up or login: the app creates each person's shared account and unique ID automatically, and you invite
friends to a project or class by sending an invitation code.

```powershell
server.bat start --domain your-name.ngrok-free.dev   # on the computer that runs the server (needs uv and ngrok)
```

Then, in every app's `.env`: `WAYPOINT_COLLAB_URL=https://your-name.ngrok-free.dev`. Group Projects then asks once to confirm the connection to the external server.
Full guide, including running it on a separate computer, daily commands and troubleshooting:
[Running the shared server](docs/running-the-shared-server.md). Service details:
[services/collaboration/README.md](services/collaboration/README.md).

## Docker

After native setup has generated `.env`, Docker users can run:

```sh
docker compose up --build
```

Docker supports the temporary-token mailbox method, not Windows COM. It uses its
own SQLite/model-cache volume. Open the same localhost URL. API docs are at
`http://127.0.0.1:8000/docs`; Coach and email Q&A both use port 8642.

## Project evaluation and Blackboard demo

For sandboxed project evaluation, keep Docker running and start the host worker:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/evaluator.ps1
```

The worker uses fixed recipes in disposable containers; Hermes receives no terminal
or Docker access. Fresh databases automatically load the fully synthetic, shared
`services/api/fixtures/blackboard-demo.json` snapshot. It contains no credentials,
student information, or university-owned course files.

To replace it locally with approved read-only material, run the host importer with
an explicit course-folder path:

```powershell
.venv\Scripts\python.exe scripts\import_blackboard_demo.py --root "PATH_TO_APPROVED_COURSE_FOLDERS"
.venv\Scripts\python.exe scripts\smoke_blackboard_tools.py
```

The importer extracts only allowlisted content and labels synthetic demo material. It
never logs into Blackboard or uploads source binaries. Existing imported courses are
never overwritten by the startup fixture. Folder scans performed by Hermes see only
host paths (native) or paths explicitly mounted into its Docker container.

## Checks

```sh
npm run build
npm test
# Windows
.venv/Scripts/python -m pytest services/api/tests
# macOS
.venv/bin/python -m pytest services/api/tests
```

The shared server and its app-side package have their own suites (see
[services/collaboration/README.md](services/collaboration/README.md)):
`cd packages/collaboration-auth && ../../.venv/Scripts/python -m pytest` and, from `services/collaboration`,
`uv run --locked pytest` (set `COLLAB_TEST_DATABASE_URL` to include the PostgreSQL tests).

If an AI provider is unavailable, Waypoint reports the failure; it does not substitute
canned answers. Read [the handoff](docs/handoff.md), [Hermes architecture](docs/hermes-architecture.md)
and [future work](docs/future-work.md) before extending agent access.
