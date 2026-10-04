# Central collaboration service and teammate discovery

Status: central human collaboration implemented behind pilot flags; phase 4 reviewed class/team profiles and both deterministic matching modes implemented; personal coach bridge, central team Hermes worker and the first phase 6 release gates implemented (flags off by default); legacy cutover implemented; hosted staging and the two-machine pilot outstanding.
Date: 2026-10-03

## Execution record

- Added architecture and threat-model documents, selected PostgreSQL and the
  Keycloak OIDC reference contract. Hosting region, budget and operator provisioning
  remain deployment decisions; instructor provisioning remains deferred.
- Added independent service dependencies/lock, PostgreSQL account migration,
  strict bearer identity, health endpoints and a standalone typed browser client.
- Added loopback-only PostgreSQL/Keycloak development compose, a PKCE-only realm
  without demo accounts, and one-time random local credential initialization.
- Windows denied starting the disabled Docker/WSL services. Used the authorized
  native fallback: portable PostgreSQL and Keycloak, loopback-only, no installed
  Windows services. Their binaries/data stay in ignored development cache.
- Implemented native authorization-code PKCE login, one-use state/nonce, OS-vault
  refresh storage, subject-bound refresh and provider logout. Mounted the small
  broker in the local API; central service dependencies remain separate.
- Ported human rooms, invites, chat, tasks, documents, proposals, exports and events
  into the central database. Added independent project rooms, membership removal,
  bearer fetch streams, token-expiry reconnect and optional connected frontend.
  Instructor chat exclusions and protected-task proposal rules remain enforced.
- Verified 36 central tests, 7 auth tests, 15 browser-client/transport tests and 15
  local API/setup regression tests. Production frontend build and standalone client
  typechecking pass. Native checks include PostgreSQL migration/drift/concurrency,
  actual browser Keycloak login, OS-vault refresh/logout and two-account room work.
- Team transactions currently use one service-wide advisory lock to preserve event
  order. This pilot trades throughput for correctness; scaling needs measured
  ordering/locking. Presence assumes one API process.
- Both pilot flags default off. No local team data is uploaded. Phase 2 still owes
  the opt-in legacy-data importer, reviewed cutover/rollback and full UI/two-machine
  pilot. Phase 3 next adds peer classes and code invitations; shared profiles,
  discovery and new agent tools remain later phases. Public deployment and package
  allowlists remain gated by phase 6.
- Phase 3 first slice now adds peer classes, organizer-created assignments,
  class/project code joins, expiring hashed codes, revocation, persistent redemption
  quotas, class membership removal/leave and project lead transfer. Class organizers
  remain student-role members and cannot read another team's chat. English/Arabic
  UI is connected. PostgreSQL upgrade over an existing course and downgrade pass.
- Latest checks: 42 central tests, 7 auth/live-provider tests and 39 frontend tests
  pass; frontend production build passes. Native development schema upgraded to
  `0003_classes`. Phase 3 still owes team openings/join requests, ownership transfer
  for classes, archive behavior, a full UI/two-machine pilot and production quotas.
  Phase 4 reviewed profile publication and deterministic matching remains pending.
- Phase 3 openings slice now adds class-scoped lead-published openings with desired
  roles/commitment, private request notes, student cancellation and lead approval.
  Approval rechecks capacity, membership, account state, opening/request expiry and
  assignment exclusivity; joining any assignment team cancels other pending requests.
  Closing an opening cancels pending requests. Request retries are idempotent and
  do not extend expiry. English/Arabic UI supports publishing, browsing and decisions.
- Latest checks: 47 PostgreSQL/service tests, 7 auth/live-provider tests and 39
  frontend tests pass. The real two-account integration now covers class code join,
  opening discovery, request and approval. Build passes; native development schema
  upgraded to `0004_openings`. Complete browser
  UI/two-machine pilot, legacy cutover and public deployment gates remain outstanding.
- Lifecycle slice adds class organizer transfer plus reversible class/project
  archives. Archives suspend team reads/writes/streams, preserve history, revoke
  invitations, close openings and cancel pending requests. Restore does not revive
  those entry points or individually archived projects. Creator identity now keeps
  creation quotas stable through ownership transfers. English/Arabic controls and
  archived-project browsing are wired into the pilot UI.
- Latest verification: 51 service/PostgreSQL tests, 7 auth/live-provider tests and
  39 frontend tests pass; production build passes. The real two-account journey
  includes ownership transfer, loss of former-owner authority, archive suspension
  and restoration. Native schema is `0005_lifecycle`. Next implementation is phase
  4 reviewed profile publication and deterministic matching. Full browser/two-machine
  pilot, legacy import/cutover, package inspection and deployment gates still remain.
- Phase 4 first slice adds class-scoped reviewed self-described profile publication,
  versioned editing, withdrawal and body-free consent audit. Discovery defaults off;
  membership end and class archive clear shared bodies/preferences. Team membership
  never publishes a profile and restoration never republishes withdrawn data.
- Private preferences and the bounded `fit-v1` scorer return whole-team combinations
  from eligible opted-in students. Required team skill coverage, languages, hours
  and meeting overlap are enforced; missing data stays explicit. Recommendations
  reserve nothing, create no invitations and retain no durable body cache. Candidate
  reads check current version/consent; browser result memory expires after a minute.
- Latest checks: 57 service/PostgreSQL tests, 7 auth/live-provider tests and 39
  frontend tests pass; build passes. Live two-account coverage includes reviewed
  profile publication, matching, withdrawal and stale-read denial. Native schema
  upgraded to `0006_profiles`. Phase 4 still owes separately consented team-profile
  context and existing-team matching. Hermes drafting/search bridge is phase 5.
  Full UI/two-machine pilot, legacy cutover, packaging and deployment remain gated.

- Phase 4 second slice adds independent, reviewed team profiles with separate
  opening-discovery consent. Team member reads exclude instructors; profile events
  contain only account/version and exclude instructors. Leaving/removal or class/
  project archive clears team bodies and discovery permission in the same event
  transaction. Class and team withdrawals do not affect each other's consent.
- Existing-team matching uses live class/assignment openings, capacity and only
  current members' separately consented team summaries. Missing summaries stay
  unknown; hard language/hours/meeting requirements reject unknown values. The
  forming-team target size is not a hard filter on existing teams. Results are
  bounded to 100 openings and the top three suggestions; no places are reserved.
  Explicit join requests carry a digest rechecked atomically against current
  consent/version, membership, opening and private preferences. Retries preserve
  the original request and lead approval remains required.
- English/Arabic pilot controls support team profile review/publication/withdrawal,
  member-only summary refresh, both matching modes and explicit join requests.
  Shared result/summary displays expire after 60 seconds. Latest verification:
  63 service/PostgreSQL tests, 7 auth/live-provider tests and 39 frontend tests pass;
  production build passes (existing chunk-size warning). Real provider coverage
  includes existing-team matching and stale-match rejection after withdrawal.
  Native schema is `0007_team_profiles`. Next is the isolated coach bridge; full
  browser/two-machine pilot, legacy cutover, packaging and deployment remain gates.

- Phase 5 first slice adds the personal coach bridge (`services/api/app/collab_coach.py`).
  The student opts in from the Collaboration screen (loopback, origin and header checks reused
  from the sign-in router). Opt-in is in-memory only: it ends after two hours, on opt-out, on
  sign-out, or when the API restarts. Each coach run then gets a 15-minute capability. Every tool
  call re-checks the capability, that the run is still `running` on a thread owned by the same
  student, that the opt-in belongs to the same sign-in session, and that a central bearer token
  can still be obtained; central membership and consent checks run on every call too.
- Six read-only tools (`waypoint_collab_*`) call fixed central paths with pattern-validated ids;
  Hermes never supplies a URL, header or credential. Responses are marked untrusted peer data,
  size-capped, and the join-request snapshot is stripped. Publishing, invitations and join
  requests stay explicit UI actions. New skill `waypoint-collaboration-coach`; 13 tests cover
  opt-in, forged/expired/finished/re-consented capabilities, cross-student runs, route
  retargeting and central refusals. Latest checks: 525 API tests, 6 auth tests, 85 frontend
  tests and the production build pass.
- Phase 5 central team Hermes (`team_hermes.py`, `hermes_tools.py`, migration `0008_team_ai`, plugin
  `.hermes/plugins/waypoint-team`). `@hermes`/slash commands queue a run in the same transaction as the
  message, after per-person, per-team and backlog budgets. An in-process worker claims the oldest run of a
  team with nothing running, using a lease and a per-attempt claim token; expired leases retry once more,
  then fail privately to the asker. The gateway call holds no transaction (every team transaction takes the
  service-wide advisory lock). Only the current claim can post the reply or fail the run, so a late or
  retried worker cannot duplicate messages.
- Tools need the service tool token AND the run's grant (team, run, invoker; expires with the run and is
  deleted on completion). There is no inferred-run fallback: `run_id` is required. The invoker is
  re-authorized on every call, so removal, archive or account disable stops a run mid-flight. Context is
  shared project state only (no facts, roadmaps, profiles, files, mail or memory). Proposals are capped per
  run and idempotent per request (`uq_proposal_run_request`), so retries cannot duplicate them. Provider,
  model and keys are server settings. 12 new PostgreSQL tests; 75 central tests pass.
- Phase 6 first slice: `scripts/artifacts.py` builds and inspects the student and central zips (allowlist over
  git-known files, hashed manifest, reproducible); 19 tests cover clean builds, contents and 14 tamper cases.
  Added `services/collaboration/Dockerfile` (non-root, healthcheck, no access log, built from the central zip),
  `.github/workflows/release-gates.yml` (student tests/build, artifact inspection, central PostgreSQL tests,
  image build), `scripts/backup.py` (backup, verify-by-restore, refuse non-empty restore; verified on the real
  PostgreSQL instance), and API/client compatibility (`/v1/capabilities` api_version and min_client_version,
  HTTP 426 gate, `X-Waypoint-Client-Version` sent by the app, Hermes UI now follows the service's `team_ai`).
  Not exercised here: the Docker build and the workflow itself (Docker is unavailable on this machine and the
  workflow has not run on a CI host).
- Legacy cutover (runbook: `docs/collaboration-cutover.md`). Local lead previews then confirms; the app sends a
  bundle (no chat or personal data) to `POST /v1/teams/import`; the importer becomes the only member of a new
  independent project with stable uuid5 IDs, other people's tasks start unassigned with a note, repeats are
  refused, and the local team is frozen read-only (`team_cutovers`, enforced in `policy.authorize`). Reopening
  is a local script only. Migration `0009_legacy_import`. Tests found and fixed two real defects: child IDs
  collided across two teams of one importer, and unexpected central errors were relayed to the student.
  86 central + 552 API + 85 frontend tests pass; the UI step has not been exercised in a browser.
- Live verification (`services/collaboration/scripts/check_native.py`, real loopback Keycloak PKCE logins, OS
  vault, two real JWT identities, real HTTP): the existing journey plus, new, a legacy-team move (dry run, real
  move, sole-member project, repeat refused) and an `@hermes` run through the real worker, the real HTTP gateway
  protocol (served by a loopback fake gateway in the test) and the real tool endpoints with real grants:
  one proposal created as the asker, reply posted once, the finished run's grant and a forged service token
  denied. The native development database is migrated to `0009_legacy_import` and the dev service on port 8100
  restarted on this code. Not live-verified: the local-app side (coach bridge tools, move button) against the
  live service, and any real Hermes gateway with the central plugin.
- Student-app live pass (local API on a temporary database, frontend with shared mode on, real Keycloak PKCE
  sign-in in the browser pane, throwaway test user deleted afterwards): coach opt-in persists across reloads;
  the lead's local team lists under "Teams on this computer"; preview shows counts, exclusions and who to
  invite; the confirmed move created the shared project (progress intact), the local copy then refused writes
  with 409 and stayed readable, and the moved team left the local list. Live testing found five defects that
  the mocked tests could not: opt-in calls lacked the local identity header; the move route sat outside the
  broker cookie's path (`/api/collaboration/auth`); a same-origin GET carries no Origin so the status read
  was refused (now a POST); seeded IDs containing dots failed bundle validation; validation errors were
  hidden from the student. Route-table and dotted-ID regression tests were added. Still not live-verified:
  a coach run calling the `waypoint_collab_*` tools (needs a Hermes gateway) and a real Hermes gateway with the
  central plugin.
- Staged profile draft (last open code item of phase 5): `waypoint_collab_draft_profile` lets the coach stage the
  reviewable profile fields (no `looking`, strict limits, `extra=forbid`) for a class the student is verified to be
  in. The draft lives in API memory for 30 minutes, is read once by the student's own page
  (`POST /api/collaboration/auth/coach/draft`), is cleared on opt-out, and only fills the form: the student still
  ticks the review box and publishes. 7 new tests; 558 API tests pass. Not exercised in a browser or with a real coach run.
- ngrok pilot (now `docs/running-the-shared-server.md`): `pilot/proxy.py` is an allowlisting reverse proxy (service API
  plus Keycloak login endpoints only; admin console, master realm, account console and `/internal/*` are 404;
  traversal and encoded-path tricks refused; per-client login rate limit using the tunnel's own forwarded address;
  8 MB body cap; streaming preserved) and `pilot/pilot.py` starts Keycloak with the public hostname, the service with
  the public issuer, the proxy and `ngrok http --url`, verifies the public issuer and that admin/master are blocked,
  and manages test accounts (one-time temporary passwords). 26 proxy tests. Verified live through the real domain
  with a throwaway account: headless-browser PKCE login across ngrok, token use, forged/no token refused, CORS for the
  app's origin only, project create, message, live event stream through the tunnel and proxy, logout revocation
  (15/15). The app sends `ngrok-skip-browser-warning` so a free domain's warning page does not break API calls.
  Not browser-tested: the full student web app talking to the public address.
- Open self-registration for the pilot (`pilot.py signup on|off|status`; Keycloak registration, 10-character password
  policy, no email verification because there is no mail server; proxy limit of 5 sign-ups per address per hour,
  tested). Verified live through the public domain: two strangers registered themselves on the sign-in page, one
  created a classroom and a project, issued both invitation codes, and the other joined with them and chatted
  (14/14). The test's repeated sign-ups tripped the hourly limit, which also confirmed it works. Note the login
  callback port 18100 is fixed per machine, so two apps on one computer collide; the test captured the callback
  itself. Not done: email verification, CAPTCHA or an approval flow; consider them before a wider public pilot.
- Silent device accounts (replaces the sign-in step; Keycloak/OIDC stays available as `COLLAB_AUTH_MODE=oidc`).
  Requirement from the product owner: no login page and no redirect; a unique ID as soon as the account exists; Group
  Projects goes straight to Create project, Create class and Join with a code. Implementation: the local API's
  `DeviceBroker` creates an Ed25519 key per local student in the OS vault, registers it once (proof of work, 300
  per day server cap, one account per key, 30 per address per hour at the proxy), then signs a single-use 60 second
  challenge for five-minute service-issued EdDSA tokens (`collaboration/device_auth.py`, migration
  `0010_device_auth`, `waypoint_collaboration_auth/device.py`). The browser calls the same local routes as before
  (`/api/collaboration/auth/session|token`), which now auto-provision; `/login` is gone in this mode. The page shows
  the account name and ID with Copy, then three cards. 13 central, 14 broker/router, 2 proxy tests; 129 central,
  20 package, 558 API and 85 frontend tests pass. Verified live through the public domain: a fresh app created its
  account and ID with no sign-in, made a class and a project, issued an invitation code, and a second brand-new
  device joined with it and its message appeared live. Limits: no recovery or multi-device (losing the vault key
  loses the account), unverified display names, anyone with the address can create accounts. The live Keycloak
  checks in `scripts/check_native.py` still cover OIDC mode only.
- Standalone server and Group Projects redesign. `server.bat start|status|stop [--all]` runs the shared server on its own
  (own virtualenv, starts PostgreSQL if needed, migrates, launches service, proxy and tunnel detached, remembers the
  domain); verified live that stopping it leaves the app running and starting it needs no arguments, and the page shows an
  explicit "Can't reach the shared server" state. The section was redesigned for the shared server with the app's own
  tokens (themes, display font, RTL): one starter panel (new project, new class, I have a code) replaces three identical
  cards, projects as cover tiles, classes as rows, a dedicated class page with tabs, invitation codes in a side sheet,
  a calmer project rail, the account ID shown briefly with copy, compact phone layout. Reviewed by screenshot in light,
  dark (vercel-dark), Arabic RTL and phone widths; fixed an invisible-button bug caused by a global
  `.fq button:not([class*="text-"])` colour rule. Frontend tests 91 pass; `server.bat` is excluded from the student zip.
- Server resilience: the service and proxy stopped overnight (last request 02:12, refused from 02:13; tunnel unaffected) with no
  error in either log and no cause found (neither launcher kills processes by name). Mitigations: server processes now launch
  detached with job breakaway, and a watchdog restarts the database, service, proxy or tunnel within seconds (verified by killing
  the service and proxy: both back in about 12 s, public 200); `stop` ends the watchdog first and clears the server ports (verified
  nothing returns). If it recurs, read `pilot-keeper.log`.
- Cleanup of the replaced sign-in (2026-10-04). Device accounts are the only sign-in, so the Keycloak/OIDC path was removed: the
  central OIDC verifier and settings (`COLLAB_OIDC_*`, `COLLAB_AUTH_MODE`), the app-side PKCE broker, callback listener and cookie
  sessions, the local dev server, the realm and Docker compose files, the Keycloak launcher commands (sign-up, add-user,
  remove-user), the proxy's Keycloak routes, and the live OIDC checks. Replaced by `scripts/smoke_check.py` (live device journey)
  and a single `server.bat` entry. Migrations now need only the database URL (`DatabaseSettings`); the vault service name is
  unchanged so existing keys keep working. Tests: 558 API, 107 central, 15 package, 92 frontend. Team covers now use the theme's
  accent and avatars match the sidebar's. Docs rewritten: root README section, service README, `running-the-shared-server.md`.
- Still open: a real gateway end-to-end run with the central plugin (only fake-gateway and mock-transport
  coverage so far), a browser run of the coach tools with a real gateway, and the
  remaining phase 6 gates: hosted staging over HTTPS, a tested restore on that host, the two-physical-machine
  pilot, and a CI run.

## Outcome and agreed direction

Keep personal Waypoint local. Deploy one optional collaboration service that every
student connects to over HTTPS. Keep its code in this repository under
`services/collaboration/`; exclude that service from the student distribution.
Support creating classes and independent project rooms, joining with invitations,
finding individual teammates, and finding existing teams with open places.
Coaches discover one another's students through student-approved shared profiles;
autonomous coach-to-coach negotiations are outside the first release.

Personal features must start and remain usable when collaboration is unavailable.
This does not promise offline AI or offline external connectors.

## Deployment and ownership

| Component | Runs where | Owns |
|---|---|---|
| React frontend | Student app | Personal and collaboration views |
| Existing FastAPI and personal Hermes | Student machine | Personal SQLite, facts, roadmaps, evidence, mail, personal memory |
| Collaboration FastAPI | Central host | Accounts, classes, memberships, profiles, discovery, invitations, team state |
| Team Hermes worker | Central host | Team-scoped runs; no personal tools or memory |
| Collaboration database | Central host | Authoritative shared records and durable events |

Use a separate database, migrations, configuration and test suite for collaboration.
Start with one central application and worker, not separate matching/chat services.
Proposed storage default: PostgreSQL for shared production data; preserve SQLite
as the authoritative personal store. Confirm the shared database choice in phase 0
and update architecture documentation to state that ownership explicitly.

Directory target:

```text
services/api/                    existing personal backend
services/collaboration/          independent central app, worker, migrations, tests
packages/collaboration-client/   versioned browser API contracts and client
docs/collaboration-architecture.md
docs/collaboration-threat-model.md
```

Browser collaboration requests go to the central API using the signed-in user's
session. Local personal coach tools call the central API through a narrow local
adapter using that user's delegated, scoped credential. Never put credentials in
model prompts. Credentials stay in protected local storage, not browser
localStorage. No central service connection into a student's machine or database.
The authentication design must specify browser/session handling, desktop login,
logout, refresh, CSRF/CORS, stream authentication and credential storage before
these paths are implemented. Personal student IDs are not central account IDs.

## Existing implementation to reuse and untangle

- `services/api/app/teams/`: team models, policy, tasks, chat, documents, imports,
  proposals, events and Hermes integration already exist.
- `services/api/app/identity.py`: demo identity and a foreign key into personal
  students must not become public service authentication. Preserve `current_user()`
  as the authentication seam; provide a central equivalent for central routes.
- `services/api/app/teams/hermes_tools.py`: `teammate_card()` currently reads
  StudentProfile, StudentFact and RoadmapVersion directly. Replace this dependency
  with explicitly published profile fields.
- `services/api/app/teams/models.py`: every team currently requires an assignment
  and course. Generalize it for independent rooms without inventing fake courses.
- `src/lib/teams-api.ts` and `src/components/teams/use-team-stream.ts`: currently
  share local API/identity assumptions. Introduce a separate collaboration client.
- `services/api/app/teams/seed.py`: demo data creates personal student records.
  Keep demo fixtures out of the hosted production bootstrap.
- `.hermes/plugins/waypoint/`: extract or register a separate central team toolset;
  do not deploy the personal plugin's full capabilities to the shared worker.

Preserve transactional team events and replay, instructor chat exclusion, private
notices, proposal voting and visible lead overrides, protected task states, and
all-or-nothing batch acceptance. Team activity never creates StudentFacts.

## Product and data contracts

### Classes, projects and roles

- A class has memberships and may have assignments and project rooms.
- An independent project room has no required class or assignment.
- A student-created class is a peer space. Its organizer can manage membership
  and invitations but receives no instructor access to other teams' work or chat.
- Instructor authority requires an explicit verified provisioning policy; do not
  infer it from creating a class or selecting a role. Defer instructor provisioning
  in the first peer-class release if that policy is not ready.
- Joining a class does not join a team. Invitation types explicitly distinguish
  class entry from project membership.
- Assignment-scoped teams retain the one-team-per-student-per-assignment invariant.
  Independent rooms do not impose that restriction across unrelated projects.

Core records: Account, Class, ClassMembership, Assignment, Team, TeamMember,
Invite, SharedProfile, DiscoveryPreference, TeamOpening, JoinRequest and existing
team content/proposal/run/event records. Define constraints and transition tables
before schema implementation; enforce capacity and uniqueness transactionally.

### Shared profiles and consent

The personal coach can draft a profile. Publishing requires explicit student
review; edits to local facts never silently republish it. Shared fields include
chosen skills, preferred roles, interests, learning goals, availability/timezone,
languages and expected commitment. Record publication version, timestamp and
self-described versus explicitly shared evidence provenance. Do not publish raw
evidence, grades, private weaknesses, email, personal memory or private chat.

Visibility is class-scoped for discovery and separately consented for joined-team
context. Students can edit or withdraw each scope. Removal from a class immediately
ends discovery access. Withdrawing discovery does not erase historical messages or
team membership; explain these distinctions in the UI. Keep private matching
preferences separate from publicly visible fields. Expire cached recommendations
and reauthorize candidate reads when consent or membership changes.

Discovery defaults off. A student opts into looking for a team for a particular
class/assignment. A team's authorized lead publishes open places, desired roles
and expected commitment. No global public student directory in this release.

### Matching

First apply hard eligibility: caller membership, candidate consent, scope,
availability status, team capacity, assignment membership and user-designated
hard requirements. Unknown availability is unknown, not an assumed match.

Then compare complementary skill coverage, interests, role preferences, learning
goals, commitment and meeting overlap. Use a bounded deterministic scorer and
bounded candidate-combination search initially. Version the scoring policy and
return the actual factors, missing information and tradeoffs. Hermes explains
these results; it cannot invent characteristics or bypass eligibility.

Support two modes: form a team with available individuals; join a team advertising
an opening. Recommend a few whole-team combinations, not just top individuals.
Avoid sensitive-trait inference and unsupported personality/reliability scores.
Use synthetic cases to evaluate fit, including complementary teams, sparse data,
schedule incompatibility and conflicting preferences.

Recommendations never reserve seats or create memberships. Invitations and join
requests require explicit user action. Accepting an invitation or approving a join
request rechecks capacity, membership, expiry and permissions in one transaction.
Each student consents to their own membership; no coach enrolls another student.

### API and Hermes surface

Version the central API from the start, for example `/v1`. Contract groups:
session/me; classes/members/invites; profiles/consent; discovery/preferences/matches;
teams/openings/join-requests; existing team content/proposals/events.

Provide bounded personal coach tools to read owned discovery settings, request
matches and read eligible published candidate/team summaries. All tools require a
running personal run, a local grant and central user authorization. Responses are
untrusted data. No invitation or publication side effect in a search tool.
Show profile publication and invitation actions in explicit UI controls first.

Central team tools require their own service authentication and expiring run
capabilities tied to team, actor and scope. Reject ambiguous/missing run identity;
do not carry forward the current fallback that infers a running team run. Workers
must enforce durable per-team serialization, retries and idempotent completion.
Provider/model selection and keys remain server-side, independently configured
for personal and central deployments.

## Execution phases

### 0. Lock the boundaries and threat model

Deliver `docs/collaboration-architecture.md` and
`docs/collaboration-threat-model.md`, schema sketch, permission matrix and API
contracts. Decide the concrete identity provider, shared database, session flow,
instructor provisioning and pilot hosting/AI budget. Infrastructure provisioning
or spending is not part of this planning change.

Cover cross-class leakage, malicious profile/chat text, code guessing, invitation
abuse, removal during a run/stream, profile consent revocation, token theft,
proposal flooding and shared-worker isolation. Define quotas and retention.

Exit: each record has one owner; every route/tool/stream has an authorization rule;
personal data flows are explicit. No new agent access before this gate is met.

### 1. Scaffold and authenticate the central service

Create an independently runnable app, migrations, health checks, configuration,
account identity and central authorization helpers. Add the client package and a
separate central base URL without rerouting personal requests. Add an explicit
development command to run the central app; normal student startup does not run it.

Exit: two real test identities reach the central API, unauthenticated and forged
demo-header requests fail, central/local database paths cannot overlap, and local
Waypoint starts with the central service stopped. Production has no demo switcher.

### 2. Extract existing project collaboration

Port existing team models/routes/policy and event log into the service, adapting
identity and independent-room relationships. Switch the team frontend and streams
to the central client. Replace personal-profile reads with empty/approved shared
cards. Port regression tests; validate database-specific transaction behavior.

Specify a one-time, explicit import path for real existing local team data, with
account mapping, dry run, backup and stable IDs. Never silently upload local data.
Demo fixtures can be reseeded. Avoid dual writes; keep the previous local data
untouched for rollback. Document the cutover and any read-only legacy view.

Exit: two clients can share a room, chat, tasks, documents and proposal decisions;
existing privacy and protected-state tests pass on the target database. Restart and
event replay recover state without duplication. No central import of StudentFact.

### 3. Classes, invitations and team openings

Implement peer class creation, class joining, assignments where needed, room
creation, revocable/expiring invitation links and human-readable codes. Store
invitation secrets safely, rate-limit redemption and bind scope/role server-side.
Add leave/remove/lead-transfer/archive behavior and immediate stream revocation.
Implement team openings and join requests with concurrency-safe seat allocation.

Exit: a class can hold multiple teams; classmates cannot read other team chats;
class organizers cannot impersonate instructors; simultaneous joins cannot exceed
capacity or violate assignment membership; revoked codes no longer work.

### 4. Shared profiles and deterministic discovery

Build profile draft/review/publish/edit/withdraw UI, scoped discovery settings,
team-opening search and both matching modes. Persist profile versions and consent
scope. Add combination scoring with explanations and explicit invitation actions.

Exit: unreviewed or opted-out profiles never appear; other classes cannot inspect
them; withdrawal invalidates cached access; fit fixtures cover missing data and
team complementarity; profiles never become personal StudentFacts automatically.

### 5. Personal coach bridge and central team Hermes

Implement the narrowly authorized discovery adapter and structured recommendation
cards. Deploy the isolated central team worker and toolset, preserving proposal
acceptance semantics. Set run/token budgets, proposal limits, cancellation,
timeouts and durable work claiming. Human collaboration works without AI enabled.

Exit: “find teammates” and “find a team to join” produce authorized explainable
results; malicious profiles cannot invoke other tools or publish data; team runs
cannot access personal files/mail/memory; removal or revoked scopes deny later
tool calls; worker retries cannot duplicate messages or proposals.

### 6. Package, deploy and pilot

Build two allowlisted artifacts: student app (UI/local API/personal runtime/client)
and central deployment (API/worker/migrations). Exclude central source/runtime,
database and credentials from student packaging; exclude personal databases and
personal tooling from the central image. Inspect artifact contents in CI.

Deploy staging over HTTPS with migrations, backups and a tested restore, redacted
logs, health checks, limits and server-side secrets. Specify API compatibility and
minimum client version behavior before releasing independently updated clients.
Run the pilot on two physical machines with different accounts.

Exit: class join, profile publishing, both match modes, invite acceptance and team
work all succeed across machines; creator offline does not stop collaboration;
disconnect/reconnect catches up; personal work survives a central outage. Verify
removal/logout, failed AI, duplicate requests, stale proposals and version mismatch.

## Verification and rollout

Use existing team tests as behavioral regression coverage; add focused permission,
consent, race and replay tests against the central production database engine.
Run `npm run build` for frontend changes and the relevant personal backend tests
when changing the local bridge. Define the central test command in phase 1.
Use integration tests for auth/stream behavior and a two-client end-to-end scenario
for the complete class-to-team journey. Do not claim production readiness from
mock authentication or SQLite-only concurrency tests.

Ship behind a collaboration feature flag to a small pilot. A rollback disables
new collaboration access or restores the prior central deployment; never resume
writing old local team copies after central cutover. Define backup/version rollback
compatibility for schema changes. Offline shared editing, federation, autonomous
coach negotiation and global matching remain deferred.

## First execution slice

Start with phase 0, followed by the phase 1 service skeleton and authenticated
identity boundary. Do not begin by moving the whole `teams/` directory: its current
identity, personal database and gateway dependencies need explicit replacements.
Implement later phases as reviewable changes with their exit checks recorded.
