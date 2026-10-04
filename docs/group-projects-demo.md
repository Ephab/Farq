# Group Projects demo

Selecting the existing **Demo Student** account opens a browser sandbox instead of
the local or shared team service. All app installations ship the same fictional
baseline: two classes, four projects (three joined and one invitation), 48 tasks,
12 documents with 48 populated sections, 12 milestones, 32 messages including
polls and sample Hermes proposals, eight decisions, and an example join request.
The demo includes both leader and member views. It does not include team summaries
or meeting schedules.

`src/lib/demo-teams-seed.ts` keeps the canonical baseline as a private serialized
fixture and returns independent copies. No seed rows are inserted into SQLite or
Postgres. `DemoTeamSandbox` handles reads, edits, chat, document locks/saves/exports,
proposal decisions, invitations, classes, and project membership in memory. Changes
are saved under `waypoint.group-projects-demo.v1` in this browser's localStorage;
they survive reloads but do not affect another browser/computer or the original
fixture. **Reset demo** restores the fixture and returns to the projects list.
Blocked storage still permits an in-memory demo for the current page load.

The stable identity is `demo-student`; there is no shared access token or private
key. `useCollaborationMode` selects demo mode before requesting collaboration
status, consent, a device account, or a token. `teamClient("demo-student")` always
uses the sandbox, even if a caller supplies a central transport. Background unread
checks use the same sandbox. Unknown operations reject locally; JSON requests,
streams, and exports have no network fallback. Real users retain their normal
local/shared transports, consent, identity, permissions, and transaction/event-log
requirements. Synthetic demo events are browser-only and never enter `team_events`.

Live Hermes runs, project-description extraction/uploads, coach discovery, and
local-to-shared migration are unavailable in the sandbox. Prewritten Hermes
proposals can be voted on or accepted locally; they only add sample tasks and never
rewrite tasks already in progress or completed. The settings drawer explains this
and offers `DEMO0004` to try joining Library Queue. Demo invite codes refer only to
the local copy and cannot enroll a real account.

Verification covers independent fresh stores, immutable fixture/response copies,
local persistence and reset, unavailable/corrupt storage, explicit central transport
override, zero network fallback, event replay through the production reducer,
leader/member restrictions, proposals, document version conflicts and exports,
leaving/joining, and unchanged real-account routing. Browser checks exercise the
full app shell, persisted edits, reset, default chat, sidebar preferences, English
and Arabic mobile layouts, and verify that no Group Projects network requests occur.
The updated frontend must be distributed to other installations; no database or
shared-service migration is required.
