# Running the shared server on its own, with ngrok

The shared server is what lets people with the Waypoint app work together: projects, classes, invitation codes, chat,
tasks and documents. It is a separate program from the app. You can run it on your own PC or on a different computer that
stays on, expose it with an ngrok address, and everyone points their app at that address. Starting, restarting or quitting
the app never touches the server, and stopping the server never touches the app.

```
each person's Waypoint app --https--> https://<your-name>.ngrok-free.dev
                                          |
                                     ngrok tunnel --> small proxy (127.0.0.1:8200: only /v1 and /health, rate limits)
                                                          |--> shared service   (127.0.0.1:8100)
                                                                   '--> PostgreSQL (127.0.0.1:55432, never exposed)
```

People never register or sign in. The first time someone opens **Group Projects**, their app creates a shared account in
the background and shows their unique ID (see [how accounts work](#how-accounts-work)).

## What you need (on the computer that will be the server)

- **Windows 10/11.** (macOS and Linux need a manual PostgreSQL and the commands in
  [the service README](../services/collaboration/README.md); `server.bat` is Windows-only.)
- **This repository** (a clone or a copy of the folder), with [uv](https://docs.astral.sh/uv/) installed
  (`winget install astral-sh.uv`). About 1 GB of free disk space.
- **An ngrok account** with a free **reserved domain** (ngrok dashboard > Domains), the ngrok program installed, and your
  auth token added once: `ngrok config add-authtoken <your token>`. Keep the token to yourself.

## Start it (the first time takes a few minutes)

Open a terminal in the repository folder and run:

```powershell
server.bat start --domain your-name.ngrok-free.dev
```

On the first run it sets up everything it needs by itself: the server's own Python environment, its local
configuration (a random database password and signing key), PostgreSQL (a download of about 300 MB, installed in the
ignored `.cache` folder, no Windows service), the database tables, and then the service, the proxy, the tunnel and a
watchdog. When it finishes it prints the address and the three lines people need. After that, `server.bat start` needs no
arguments because the domain is remembered.

You can close the terminal: everything keeps running on its own.

## Connect the app

On every computer that should use the shared server, open the app's `.env` and set the address:

```
WAYPOINT_COLLAB_URL=https://your-name.ngrok-free.dev
```

Restart the app and open **Group Projects**. The first time, a pane says Group Projects will connect to an external server,
names its address, and lists what is sent (your name, ID and what you put in projects and classes) and what stays on your
computer. Choose **Connect**; your choice is remembered for that address, and **Disconnect from the shared server** at the
bottom of the page takes it back. The page then creates the account and shows your name and ID with three choices: **New project**, **New class** and **I have a code**. To invite friends, open a project
or class, choose **Invite friends** (or **Invite classmates**), and send them the code. They enter it under **I have a code**.

The page works on the computer running the server too: it connects to the same address as everyone else.

## Every day

```powershell
server.bat status          # what is running, and whether the public address answers
server.bat stop            # stops the service, proxy, tunnel and watchdog (PostgreSQL keeps running)
server.bat stop --all      # also stops PostgreSQL
server.bat start           # starts it again
```

- **If the server is off,** Group Projects shows "Can't reach the shared server" with a Try again button. Everything else in
  Waypoint keeps working, and people reconnect by themselves when you start it again.
- **The watchdog** (started by `start`) restarts the database, service, proxy or tunnel within seconds if one of them stops.
  Its log is `.cache/collaboration-native/pilot-keeper.log`. `server.bat stop` ends it first so nothing comes back.
- **Start it automatically when you sign in to Windows** (optional):
  `schtasks /Create /SC ONLOGON /TN "Waypoint server" /TR "\"C:\full\path\to\repo\server.bat\" start"`
  (remove with `schtasks /Delete /TN "Waypoint server" /F`).
- **Check that it really works end to end** from any computer:
  `cd services\collaboration` then `.venv\Scripts\python scripts\smoke_check.py https://your-name.ngrok-free.dev`. It
  creates two throwaway devices, a class and a project, joins with invitation codes and chats.

## Team Hermes (`@hermes` in project chat)

Turn it on once and it is remembered:

```powershell
server.bat start --team-ai       # on (use --no-team-ai to turn it off)
```

It runs its own Hermes gateway on 127.0.0.1:8643, completely apart from the Waypoint coach's gateway (8642) and from any
Hermes you use yourself: its own home folder under `.cache\collaboration-native\team-hermes`, its own lock folder, only the
team tools (read one project's shared state, create proposals), no memory, no files, no web. It only uses the installed `hermes`
program, read-only, and never touches your own Hermes data. Teammates still accept every change it proposes.

- **It needs** `OPENROUTER_API_KEY` in the repository's `.env` (default model: Space Bunny Alpha; an optional `GEMINI_API_KEY` serves the fallback models) (this PC's own key; the shared service never sees it) and the
  `hermes` program installed. If either is missing, `server.bat start` says so and starts without it.
- **The first start takes several minutes** while Hermes prepares the gateway's own runtime. Later starts take seconds.
- **If the model is busy** (Gemini "high demand"), a run moves on to the next model automatically.
- Team messages sent to `@hermes` go to Google's Gemini API from this PC, so chat sent that way is visible to Google as well as
  to whoever runs the server. Leave it off if that is not acceptable.
- Logs: `.cache\collaboration-native\pilot-team-hermes.log` and `team-hermes\home\logs`.
- Check: `smoke_check.py` (below) also sends `@hermes` a request and waits for the reply when team Hermes is on.

## Using a separate computer as the server

Nothing changes except where you run it. Copy or clone the repository to that computer, install uv and ngrok there, add your
auth token, and run `server.bat start --domain ...`. The app computers only need the address. Keep that computer awake
(Windows power settings: never sleep) and plugged in. If you move the server, copy `.cache\collaboration-native` too
(it holds the database and the signing key) or people will have to start over.

For a real, always-on deployment rather than a PC behind ngrok, build the central artifact
(`python scripts/artifacts.py build central`), run its `services/collaboration/Dockerfile` on a host with PostgreSQL and
HTTPS, and set the variables in [.env.example](../services/collaboration/.env.example). See
[the service README](../services/collaboration/README.md).

## How accounts work

- The app keeps a private key for you in the operating system's credential store (Windows Credential Manager). It never
  leaves your computer and the browser never sees it.
- The app registers the matching public key once. Registering costs a moment of computation (a small proof of work) so bots
  cannot create accounts cheaply. The server returns your account ID.
- Afterwards the app proves it holds the key by signing a short challenge and gets a five-minute access token. There are
  no passwords.
- **Losing the key loses the account.** A new computer, a reinstall or clearing the credential store means a new account and
  ID; the old projects stay with the old one. There is no recovery or multi-device sign-in yet.
- Display names are whatever people have in their Waypoint profile and are not verified. Anyone who knows the server address
  can create an account. Limits: the proof of work, 30 new accounts per address per hour at the proxy, and 300 per day on
  the server (`COLLAB_DEVICE_REGISTRATIONS_PER_DAY`).

## When something is wrong

| What you see | Likely cause and fix |
|---|---|
| App says "Can't reach the shared server" | `server.bat status`. If anything shows "not running", run `server.bat start`. If the public line is not 200, check the tunnel (`ngrok` needs your auth token and the reserved domain). |
| Public address answers 502 | The tunnel is up but the proxy or service is down. Run `server.bat status`, then `server.bat start`; read `.cache\collaboration-native\pilot-keeper.log`. |
| "Port 8100 (or 8200) is used by another program" | Something else owns that port. Stop it, or run `server.bat stop` if it is an old copy of the server. |
| First start fails downloading PostgreSQL | Run it again (the download resumes); you need internet access and about 1 GB free. |
| ngrok: "authentication failed" or "domain not found" | Run `ngrok config add-authtoken ...` and use the exact reserved domain from the ngrok dashboard. |
| A browser shows an ngrok "Visit Site" page | A free-plan notice for browsers. The app sends a header that skips it for its own requests. |
| Logs | `.cache\collaboration-native\pilot-central.log`, `pilot-proxy.log`, `pilot-ngrok.log`, `pilot-keeper.log`, `postgres.log`. |

## Safety notes

- **Public routes** are only `/v1/*` and `/health/*`. The proxy answers 404 for everything else, including the service's
  internal endpoints and API docs, rejects path tricks, caps request bodies, and rate-limits account creation.
- ngrok ends the encrypted connection on its side, so it can technically see traffic. Do not use this for real student
  data beyond a trusted pilot, and treat chat as visible to whoever runs the server.
- **Back up** the database before updates: `python scripts/backup.py backup --out backups\shared.dump` from
  `services\collaboration` (and `verify` restores it into a throwaway database to prove it works). Dumps contain private
  chat, so store them like the database itself.
- **Updating:** pull or copy the new code, then `server.bat start` (it migrates the database before starting).
- Moving a team that lives only on someone's computer onto the server is a separate, explicit, one-way step; see
  [collaboration-cutover.md](collaboration-cutover.md).
