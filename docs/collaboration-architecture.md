# Collaboration architecture

Status: device accounts, shared-room service and the connected UI implemented.
Peer classes, expiring code invitations, reviewed profiles and individual-team
discovery are implemented. Existing-team matching and the coach bridge remain
planned. See [execution plan](superpowers/plans/2026-10-03-collaboration-service.md).

Class organizer transfer and reversible class/project archives are implemented.
Archival retains memberships/history but suspends team content access and streams.
Restoration never revives invitations/openings/requests; individual project archive
markers survive class restore. Existing members may still view the class roster.
Only the organizer can restore the class; only the lead can restore its project.

## Decisions

One repository, two independently deployed products. `services/api` and personal
Hermes stay on the student's machine. `services/collaboration` runs centrally with
its own PostgreSQL database and, later, a separate team Hermes worker. Normal
student startup never starts the central service. The central app imports no
personal models, settings, database or plugin. PostgreSQL is authoritative for
shared data; personal SQLite remains authoritative for students and roadmaps.

The browser uses `packages/collaboration-client` with a separately configured
HTTPS origin. Personal API routing is unchanged. API version 1 starts at `/v1`.
No existing team data is moved or uploaded by this foundation.

## Identity: silent device accounts

There is no login page, password or external identity provider. Each Waypoint installation creates its own shared
account the first time Group Projects opens, and shows the person a unique account ID.

- **Key custody.** The local API's `DeviceBroker` (`packages/collaboration-auth`) generates an Ed25519 key pair per local
  student and keeps the private key only in the OS credential store (no plaintext fallback). The browser never sees it.
- **Registration** (`collaboration/device_auth.py`). The app fetches a stateless proof-of-work challenge, solves it for its
  public key, and registers once with its Waypoint display name. One account per public key; a daily cap on new accounts;
  the front proxy adds a per-address hourly limit. The server returns the account ID.
- **Tokens.** The app asks for a single-use challenge (HMAC-signed, 60 seconds, bound to its public key), signs it with
  the private key, and receives an EdDSA access token signed by the service: `iss=waypoint-device`,
  `aud=waypoint-collaboration`, `typ=Bearer`, `scope=collaboration`, at most 300 seconds. The service checks algorithm,
  signature, issuer, audience, purpose, lifetime and subject on every request, and denies a disabled account at once.
- **Identity** is the generated central account ID, never a name, email, local student ID or demo header. The local
  routes (`/api/collaboration/auth/session|token|logout`) answer only loopback callers whose Origin is the app's and who
  send `X-Waypoint-Collaboration: 1`, so another website or program cannot ask this computer for a token.
- **Server-side only for the coach.** The personal coach bridge and the team move call the central API from the local
  API with the same token; a token never enters a model prompt.
- **Limits of this design.** Losing the key loses the account (no recovery or multi-device sign-in yet); display names are
  unverified; anyone who knows the server address can create an account (hence the proof of work and caps).
- The central API accepts only the Authorization bearer header: no auth cookies, query tokens or `?as=` identity. CORS has
  an explicit origin allowlist and no credentials. Streams use authenticated fetch, recheck membership and close at token
  expiry.

## Ownership and schema contract

Migration `0001_accounts` owns identity; `0002_teams` ports shared team records with
central account foreign keys. `0003_classes` adds peer organizers and hashed codes.
Independent rooms have no fabricated assignment.
The following table is the target schema. `0006_profiles` adds class/account-owned
profiles, private preferences and body-free consent audit; separate team-profile
consent remains future work. Peer classes reuse course/assignment records;
organizers have membership authority and student enrollment, never instructor powers.

| Record | Ownership and constraints |
|---|---|
| Account | Unique issuer/subject; opaque central ID; disabled flag; no personal FK |
| Class | Peer organizer owns membership administration; no implicit instructor powers |
| ClassMembership | Unique class/account; active/left/removed; membership checked on every access |
| Assignment | Belongs to a class; own deadline, rubric and team-size policy |
| Team | Optional class and assignment; assignment must belong to that class; independent rooms allowed |
| TeamMember | Unique team/account; assignment-bound uniqueness enforced transactionally |
| Invite | Hashed random secret, explicit class/team scope, expiry, revocation and usage limit |
| SharedProfile | Owner account, explicit class or team audience, published version and consent timestamp |
| DiscoveryPreference | Private to owner; class/assignment scope and hard/soft requirements |
| TeamOpening | Lead-published roles and available places; live capacity derived from membership |
| JoinRequest | Requester consents; lead accepts/declines; no membership until accepted |
| Team content | Existing tasks/documents/messages/proposals/events, with central account references |

Never use a nullable uniqueness constraint alone for assignment membership. An
assignment membership relation or partial unique index must enforce one team per
assignment while permitting multiple independent rooms. Seat allocation locks
the team and checks capacity and assignment membership in the same transaction.

## Authorization matrix

| Operation | Authorized actor |
|---|---|
| Read/update central account | That account; administrative disable through operator access |
| Create peer class or independent room | Authenticated account within quota |
| Manage class codes/membership | Class organizer; does not imply team access |
| Read discovery profiles | Active member of that class and only candidate-consented fields |
| Publish/withdraw profile or preferences | Profile owner only |
| Read team opening | Eligible class member; no private team content in result |
| Publish opening / accept join request | Team lead; requester has explicitly requested membership |
| Redeem invitation | Authenticated recipient, valid code and capacity; no instructor role granted |
| Team work | Active team member according to existing policy |
| Instructor views | Deferred until verified provisioning; retain chat exclusion in ported code |
| Personal coach match tool | Active personal run + user authorization + current class membership |
| Team Hermes tool | Central service auth + active team run capability + invoker's current permissions |

Class removal withdraws class discovery and removes access to class-bound teams
transactionally, with events and stream invalidation. Independent rooms are
unaffected. Lead departure requires transfer or archive; do not leave ownerless
teams. Invite states: active -> expired/revoked/exhausted. Join requests: pending ->
accepted/declined/cancelled/expired; duplicate acceptance is idempotent and race-safe.

Profile discovery withdrawal does not rewrite prior messages or disband teams.
Joined-team profile sharing requires separate consent. Recommendations contain
candidate IDs and current version references; opening a result rechecks current
consent/membership. No raw profile bodies in logs or durable match-result caches.
Only the student may turn a personal coach's draft into a published shared profile.

## API contract and implementation status

Implemented:

| Endpoint | Contract |
|---|---|
| `GET /health/live` | Public process health, no database/identity request |
| `GET /health/ready` | Public 200 only with the expected migration and account schema; checks team/event tables when enabled; otherwise generic 503 |
| `GET /v1/me` | Bearer token; `{id, display_name}`; 401 invalid/missing auth, 403 disabled account, 503 identity outage |
| `GET /v1/capabilities` | Authenticated feature availability; team AI/import/discovery are currently false |
| `/v1/teams`, `/v1/invites`, team content and events | Enabled only by `COLLAB_TEAMS_ENABLED`; member-authorized human collaboration |
| `/v1/classes`, `/v1/codes/redeem`, class/project `/codes` | Same pilot flag; peer organization and quota-bound code joins |
| Class `/openings`, team `/opening`, `/join-requests` | Class-scoped opening discovery; private lead decisions; no seat reservation |
| Class `/organizer`, class/project `/archive` and `/restore` | Active student ownership target; authorized reversible archival |
| Class `/profile`, `/preferences`, `/discovery/matches`, `/profiles/{account}` | Reviewed publication, private preferences and bounded matching; candidate version/consent checks |

Readiness currently checks schema availability, not live identity-provider health.
Private responses use no-store; errors never echo tokens. The versioned client
rejects redirects, omits cookies and has no local API fallback or token persistence.

Remaining discovery work: separately consented team-profile audiences and matching
existing teams. Class profile/matching routes are implemented under the pilot flag.
Code joins are idempotent while membership remains active. Future writes need idempotency keys where retries can create membership, invitations,
messages or proposals. Return 409 for stale versions/full teams, 403 for forbidden
operations and non-enumerating 404 for inaccessible records. Define concrete
request/response schemas alongside each implementation phase, before its UI.

## Operations, packaging and rollout

Run migrations explicitly before server startup; never create tables automatically.
Use a dedicated database/role and `COLLAB_*` environment variables. The service
has its own dependency lock and virtual environment. Student dependencies include
the small native auth broker, never the central service. Production deployment must supply TLS termination, rate limits, backups,
restoration checks and redacted logs before public access.

Pilot default: a single central host with PostgreSQL, reached through an HTTPS tunnel
(see [running the shared server](running-the-shared-server.md)), open device accounts and no AI worker until quotas and grant enforcement ship. No hosting has
been purchased or provisioned. Choose region and spending ceiling before deploying;
keep AI disabled until the operator sets the budget. Provisional ceilings: 60 API
requests/min/account, 10 invite attempts/min/account and source IP, 3 created
classes/day/account, 100 discovery candidates/query, 3 suggested teams, 20 matching
queries/hour/account. Enforce centrally before enabling the associated endpoints.

Student package allowlist: frontend, personal backend/runtime and collaboration
client. Central allowlist: this service, migrations and eventual isolated worker.
Neither build copies repository-wide `.env`, data files or the other product's
runtime. Existing packaging/startup has not been changed by the foundation.

Before cutover, add explicit opt-in import with identity mapping, dry run and
backup; retain old local records without dual writes. Defer offline shared editing,
federation and coach negotiation. The implementation plan lists rollout checks.

### Separate team summaries and existing-team discovery

Schema `0007_team_profiles` adds independent reviewed team summaries. Members
publish only their own selected fields; class profiles are never copied. Team
summary reads require membership, excluding instructors. Each member chooses an
additional discovery permission; an opening alone cannot publish member data.
Profile mutation events contain only identity/version, never profile bodies, and
instructors receive no profile events. Removal or class/project archival withdraws
team summaries; restoration does not republish them. Class/team withdrawal scopes
are independent. Audits contain actions/versions only and prune after 90 days during
mutation; backup deletion replay and scheduled retention remain release work.

`POST /v1/classes/{id}/discovery/team-matches` ranks live eligible openings for the
chosen assignment using private preferences and separately consented current team
summaries. Missing summaries are unknown; hard per-member constraints fail on
unknown data. Forming-team size does not filter existing teams. At most 100 openings
are examined; three results show aggregate fit, unknown count and opening details.
No private chat, coach memory or personal facts enter matching. Match-based join
requests supply `match_snapshot`; the API atomically rechecks its digest before
creating a request. Consent, member or opening changes require a fresh match.
Ordinary opening requests remain available without a matching profile. All joins
still require explicit lead approval and capacity/eligibility checks at acceptance.
