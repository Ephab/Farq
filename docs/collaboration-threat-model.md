# Central collaboration threat model

Status: design baseline plus identity foundation controls. This document does not
authorize unimplemented agent access. No new Hermes tools are enabled by the
foundation. Revisit the model and tests before each planned capability is exposed.

## Trust boundaries

Students control their desktop app, requests and published text; none are trusted
to assert identity, membership, capability or consent on behalf of another account.
Profiles, class names, messages and imported text are untrusted input to Hermes.
A device key proves which account is calling, not class roles. The central API and database
enforce authorization. Personal SQLite and local credentials are outside the
central service's access boundary. Central operators can access shared data; no
end-to-end encryption claim is made.

| Threat | Control | Verification / status |
|---|---|---|
| Forge local user ID | Service-signed bearer token only; issuer, audience, signature, purpose, lifetime and subject checks | Implemented; forged, wrong-key, wrong-algorithm, expired and no-token tests |
| Algorithm confusion or token substitution | Fixed EdDSA with the service's own key; HS256, other issuers/audiences and wrong purposes rejected | Implemented tests |
| Stolen challenge or signature replay | Challenges are HMAC-signed, bound to one public key, expire in 60 seconds and are single use | Implemented tests |
| Mass account creation | Proof of work per registration, one account per key, daily cap on the server, per-address hourly limit at the proxy | Implemented tests; email verification and CAPTCHA are not available |
| Token or key theft | TLS, five-minute tokens, private key only in the OS credential store and never in the browser, local routes limited to loopback + the app's origin + a custom header | Implemented tests; a stolen key cannot be revoked remotely yet (disable the account) |
| Disabled user reuses token | Central account disabled check on each authenticated request | Implemented test |
| Unauthorized cross-origin browser access | Exact origin allowlist, no cookies, bearer auth | Implemented preflight tests; CORS is not authorization |
| Central API opens personal database | Dedicated PostgreSQL-only configuration; no personal imports/default DATABASE_URL | Implemented tests; deployment must use separate DB role |
| Code guessing / invitation spam | 80-bit hashed codes, expiry, revocation, scoped redemption, persistent account/IP limits | PostgreSQL tests pass; trusted proxy/edge limits remain release gates |
| Account enumeration / unauthorized profile reads | Student class membership + opt-in/version checks, bounded results, non-enumerating errors | Profile scope/withdrawal and actual-provider tests pass |
| App talks to an external server without the student knowing | Local API refuses every session, token, coach and move call until the student confirms the server address once (stored per student and address in the OS vault); the page shows a pane naming the host and what is sent; disconnect withdraws it | Router tests for the gate, per-student scope and origin checks |
| Consent changes while recommendations cached | No durable profile-body cache; version/consent checks on candidate reads; UI result memory expires in a minute | Withdrawal/removal/archive tests pass; match-derived invitation tools not enabled |
| Race to fill final seat | Serialized PostgreSQL transactions + membership unique constraints | Native final-seat race passes; code redemption/idempotency remains phase 3 |
| Organizer claims instructor access | Peer organizer has student enrollment; no instructor provisioning routes | Class tests deny organizer reads of another team's state/chat |
| Removed user keeps live stream or running tool | Recheck membership for replay and each stream poll; stop at JWT expiry | Team/replay/removal tests pass; no central agent tools enabled |
| Opening/request leaks another class or private note | Class membership for discovery; no member/chat bodies; lead-only request read/decision; private event envelopes | PostgreSQL scope/privacy tests and real two-account request journey pass |
| Approvals race or accept a removed student | Serialized transaction rechecks account, membership, expiry, capacity and assignment uniqueness | Concurrent final-seat approval, expiry and removal tests pass |
| Archive bypass or old invites reopen after restore | Shared team policy rejects archived projects/classes; archive revokes invites and cancels requests; restore keeps them closed | Lifecycle tests cover content, streams, creation, restore and preserved history |
| Ownership transfer escalates privileges or resets quotas | Target must be active student member; no enrollment role change; creator identity is immutable | Transfer/authority/privacy/quota tests and real provider lifecycle journey pass |
| Profile/chat prompt injection | Treat text as data; scoped server-enforced tools; no generic shell/file/web tools | Required before phase 5 |
| Team run accesses personal files/mail/memory | Separate runtime/home/toolset; no personal credentials, tools or built-in memory | Required before central worker |
| Replay or guess another run ID | Expiring unguessable team/run/actor/scope grant + internal auth; no inferred run | Required before central worker |
| Proposal/AI flooding | Per-account/team run budget, proposal cap, queue concurrency and cancellation | Required before central worker |
| Worker retry applies duplicate effects | Durable per-team claim and idempotent output; only API acceptance applies proposals | Required before central worker |
| Sensitive text leaks through telemetry | No tokens, raw profiles, chat, uploads or connection URLs in logs | Foundation generic errors; deployment log review required |
| Public endpoint abuse | Edge request/body limits and rate limits including invalid tokens/unknown key IDs | Required before public deployment; not implemented in foundation |

## Profile and retention policy

Only explicit, reviewed fields are published. Discovery is off by default, scoped
to a class/assignment and separately consented from team context. No automatic
publication of personal facts, roadmap changes or mailbox content. Published
claims are self-described unless the student deliberately shares supporting
evidence provenance; do not infer personality or reliability from private data.

Target retention for implementation: current published profile only; consent audit
stores scope/version/timestamp and action without prior profile bodies. Withdrawal
removes the published body immediately and invalidates access. Operational metadata
retention 30 days, security/consent audit 90 days, rotating backups at most 30 days.
Account deletion removes profiles and discovery settings; retained team messages
must be pseudonymized under a documented team-history policy shown before launch.
Backup restoration must replay withdrawals/deletions before reopening service.
These retention policies are not yet implemented by the room pilot.

## Release gates and residual risk

Unit tests with generated Ed25519 keys exercise actual signature/claim validation,
not a fake "logged in" dependency. A live smoke check (`scripts/smoke_check.py`) registers two new devices and runs
class, project, invitation-code and chat journeys; PostgreSQL migration/race tests also pass. SQLite is used solely as a test double for account
storage. Readiness is a schema check; identity reachability needs operational
monitoring. Account disable is immediate; an already issued token stays valid for at most five minutes
unless the account is disabled. Anyone who knows the address can create an account.

The pilot's service-wide advisory transaction lock serializes team writes and
event reads, preventing sequence/commit-order gaps at a throughput cost. Ephemeral
presence assumes one API process and filters removed members; instructors receive
no typing state. A full UI and two-machine pilot is still required.

Do not publicly expose the foundation until TLS, edge throttling, real provider
provisioning, migrations and deployment checks are complete. Do not advertise
classes/discovery/agent isolation as implemented until their phase checks pass.

## Implemented team-summary boundary

Team publication requires reviewed fields, expected version and an explicit
additional discovery boolean (off in the UI by default). Members cannot publish
for others. Member-only reads and event replay/streams exclude instructors.
Discovery uses only current non-disabled members' published summaries with that
permission. Unshared profiles become unknown placeholders, preventing hard
availability/language requirements from passing on incomplete evidence. Result
aggregates may reveal selected shared skills; this is covered by discovery consent,
not by opening publication. No raw member profiles are returned to applicants.

Match digests bind the requesting student's current class profile/version and
preferences to team membership, consent/version and opening state. A join request
checks the digest inside the serialized transaction. Withdrawal, removal or archive
clears bodies/permissions and emits a body-free event in that transaction. Existing
classroom discovery consent is never implicitly promoted into team consent.
The UI expires displayed summaries/results after 60 seconds; previously viewed
information cannot be erased from screenshots or a recipient's memory. Production
backup/deletion replay and scheduled retention remain outstanding release gates.

## Team Hermes (central worker)

Assets: team chat, tasks, documents, proposals. Entry points: `@hermes`/slash commands, tool calls from the
team gateway. Controls: disabled unless configured; budgets per person/team/backlog; a run grant bound to
team, run and invoker that dies with the run; service tool token compared in constant time; no run-id
inference; invoker re-authorized per call (removal, archive and disable deny mid-run); proposals only, capped
and idempotent per run; lease plus claim token so retries cannot post twice; gateway call outside any
transaction; context excludes personal data and profiles; chat text marked untrusted. The team gateway must
load only `.hermes/plugins/waypoint-team` and hold no personal tools, files, mail or memory. Residual risks:
a compromised gateway host holds the tool token and active run grants (blast radius: proposals in teams with
a running run, never direct changes); the in-process worker assumes one API process.
