# Waypoint shared server (collaboration service)

The central service behind **Group Projects**: accounts, projects, classes, invitation codes, chat, tasks, documents,
openings and teammate matching. It is a separate program from the Waypoint app, with its own PostgreSQL database,
configuration and tests. It imports nothing from the personal backend and never sees a student's personal database.

- **Run it** (your PC or another computer, with ngrok): [Running the shared server](../../docs/running-the-shared-server.md).
- **How it is built:** [architecture](../../docs/collaboration-architecture.md),
  [threat model](../../docs/collaboration-threat-model.md), [plan and history](../../docs/superpowers/plans/2026-10-03-collaboration-service.md).

## Quick start (Windows)

From the repository root:

```powershell
server.bat start --domain your-name.ngrok-free.dev    # first time; sets up everything, then remembers the domain
server.bat status
server.bat stop
```

Anyone with the app then sets `WAYPOINT_COLLAB_URL=https://your-name.ngrok-free.dev` in their `.env`, opens Group Projects
and confirms the one-time connection pane. There is no sign-up: the app creates the
person's account and ID by itself.

## Layout

```
collaboration/        the FastAPI service (accounts, teams, classes, matching, team Hermes)
migrations/           Alembic migrations (run explicitly; starting the service never changes the schema)
pilot/                server.bat's launcher (pilot.py), the allowlisting proxy (proxy.py); development tooling
scripts/              init_dev.py, native_dev.py (PostgreSQL), backup.py, smoke_check.py
tests/                service tests (PostgreSQL where it matters)
Dockerfile            image built from the central artifact for a real hosted deployment
```

## Accounts

Device accounts, no login page: the app registers its own key, the service issues short-lived tokens it signs itself. The
details, limits and trade-offs are in [Running the shared server](../../docs/running-the-shared-server.md#how-accounts-work)
and the [architecture](../../docs/collaboration-architecture.md). Requests carry `Authorization: Bearer ...` only: no
cookies, query tokens, demo headers or `?as=` identity.

## Configuration

Copy `.env.example` to `.env` (or run `python scripts/init_dev.py`, which writes one with a random database password and
signing key, refuses to overwrite an existing file and never prints secrets). Never reuse the personal app's `.env`.

| Variable | Meaning |
|---|---|
| `COLLAB_DATABASE_URL` | A dedicated `postgresql+psycopg` database. SQLite is rejected on purpose. |
| `COLLAB_DEVICE_SIGNING_KEY` | Base64url Ed25519 private key (32 bytes) that signs tokens. Required; keep it secret and stable. |
| `COLLAB_ENVIRONMENT` | `production` (default) requires HTTPS origins; `development` also allows http loopback origins. |
| `COLLAB_ALLOWED_ORIGINS` | JSON list of web addresses the app runs on (no wildcards, paths or credentials). |
| `COLLAB_TEAMS_ENABLED` | Turns on projects, classes, chat and the rest. |
| `COLLAB_MIN_CLIENT_VERSION` | Refuse older app versions with HTTP 426 (a missing version header counts as old once set). |
| `COLLAB_DEVICE_REGISTRATIONS_PER_DAY` | Cap on new accounts per day (default 300). |
| `COLLAB_TEAM_AI_ENABLED` and `COLLAB_HERMES_*` | Optional team Hermes, off by default (see below). |

Manual run, without `server.bat` (from this folder; migrate first):

```powershell
uv sync --locked --group dev
uv run --locked alembic upgrade head
uv run --locked uvicorn collaboration.main:create_app --factory --host 127.0.0.1 --port 8100
```

On macOS and Linux install PostgreSQL yourself and set `COLLAB_DATABASE_URL`. Health: `/health/live` (no database) and
`/health/ready` (checks the expected schema revision) reveal only generic status.

## What it provides

- **Projects and classes.** Anyone can create an independent project or a class and invite people with expiring,
  revocable codes (80-bit, stored hashed, ten redemptions per minute per account and address). Classes are peer spaces:
  the organizer manages membership but never gets access to other teams' chat. Archive/restore and ownership transfer
  are supported; restoring never reopens old codes or requests.
- **Project work.** Chat, tasks, milestones, decisions, documents, proposals (members vote; leads can override and it is
  shown), exports, and live events with replay. Every write emits an event in the same transaction.
- **Openings and matching.** Leads publish class openings; classmates request a place; the lead approves (capacity,
  membership and expiry are rechecked in one transaction). Students can publish reviewed, self-described profiles and
  get bounded `fit-v1` team suggestions; nothing reserves a seat or sends an invitation.
- **Moving a local team** onto the server is an explicit, one-way, lead-only step
  ([cutover guide](../../docs/collaboration-cutover.md)).
- **Quotas.** Three classes per day and per account, 200 members per class, 20 active codes per account, 20 matching
  requests per hour, and the account-creation limits above.

## Team Hermes (optional, off by default)

On a Windows PC, `server.bat start --team-ai` does all of the below by itself (its own gateway on 127.0.0.1:8643, generated
tokens, the host's `GEMINI_API_KEY`); see [Running the shared server](../../docs/running-the-shared-server.md#team-hermes-hermes-in-project-chat).
By hand:


`COLLAB_TEAM_AI_ENABLED=true` enables `@hermes` and slash commands in project chat. It needs a Hermes gateway of its own
that loads only `.hermes/plugins/waypoint-team` (never the student plugin, personal memory, terminal, files or web tools)
and these settings: `COLLAB_HERMES_URL` (HTTPS or loopback), `COLLAB_HERMES_API_KEY`, `COLLAB_HERMES_TOOL_TOKEN` (also given
to the gateway as `WAYPOINT_COLLAB_TOOL_TOKEN`, with `WAYPOINT_COLLAB_INTERNAL_URL` pointing back here). Hermes can only
propose; members apply. Budgets: 10 runs per person per hour, 60 per team per day, 3 queued or running per team, 5
proposals per run, 180-second runs (each a `COLLAB_*` setting). Without it humans collaborate normally and `@hermes` answers 503. When the chosen model is busy or rate-limited a run moves
on to `COLLAB_HERMES_FALLBACK_MODELS` (a JSON list, default the next Gemini Flash models).

## Tests and checks

```powershell
# from this folder; set COLLAB_TEST_DATABASE_URL to a dedicated PostgreSQL test database to include the database tests
uv run --locked pytest -q
# against a running server (from this folder):
.venv\Scripts\python scripts\smoke_check.py https://your-name.ngrok-free.dev
```

The database tests create a randomly named schema, run migrations and drift checks, race concurrent requests, and remove
only their own schema; do not point them at production. From the repository root also run `npm run build`, and
`python scripts/artifacts.py build central` then `inspect` to verify the release artifacts.

## Operations

- **Artifacts.** `python scripts/artifacts.py build central|student` packages git-known files through an allowlist into
  `waypoint-central.zip` / `waypoint-student.zip` with a hashed manifest and inspects them for forbidden paths,
  personal-code imports, missing files, hash drift and secret-shaped content. Build the image from the unpacked central
  zip (see `Dockerfile`) and run `alembic upgrade head` as a separate step.
- **Backups.** `python scripts/backup.py backup --out X.dump`, `verify --file X.dump` (restores into a throwaway database and
  compares tables, rows and revision), `restore --file X.dump --into <empty database url>`. Dumps contain private chat; treat
  them like the database.
- **Compatibility.** `/v1/capabilities` reports `api_version`, `min_client_version`, and which features are on.
- **Logging.** The image runs uvicorn with `--no-access-log`; the service logs no tokens, bodies or profiles.
- **Known limits.** Team transactions share one PostgreSQL advisory lock to keep event order, which trades throughput for
  correctness; presence assumes one process. Public deployment still needs TLS, a trusted proxy address policy, backups with
  tested restore, and email verification or an approval step if sign-up should be limited to known people.
