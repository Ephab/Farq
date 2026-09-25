# Farq Microsoft Outlook Integration Plan

**Status:** Design/plan
**Date:** 2026-09-25
**Scope:** First local, read-only Microsoft Outlook connection for the Farq student platform

## Product decisions

The first release will support:

- University/work Microsoft 365 accounts only.
- Full mailbox read access selected by the student, including attachment access.
- The student's primary calendar only.
- Read-only behavior. The coach may read context and recommend actions, but Farq will not send email, create or edit events, create tasks, mark messages read, or move messages.
- Localhost development first.
- Manual synchronization only. The student clicks **Sync now**. Farq may use Microsoft Graph delta queries internally, but there will be no background scheduler or webhook in the first release.

Access to a full mailbox does not mean that Farq will permanently archive raw message bodies or attachments. The default retention policy is:

1. Read the message or attachment transiently.
2. Remove or mask sensitive data.
3. Store normalized records and extracted, reviewable evidence.
4. Never store original Outlook files as permanent Farq uploads.

A searchable raw-mail archive would be a separate, substantially higher-risk feature and is not part of this plan.

## Current Farq architecture

Farq currently has four important runtime boundaries:

```text
React/Vite browser
       |
       v
FastAPI + SQLite
       |
       v
Local Hermes gateway
       |
       +---- Gemini
       +---- NVIDIA NIM
       +---- Hugging Face
       |
       +---- Farq Hermes plugin
                |
                v
          FastAPI internal APIs
```

### Browser and frontend

- React/Vite owns onboarding, the coach UI, roadmap visualization, quizzes, and slides.
- The browser calls Farq's API and does not call Hermes or model providers directly: `AGENTS.md:3-4`.
- The current frontend has no route library. It keeps the active section in React state: `src/App.tsx:30-52`.
- The browser currently stores a student UUID in `localStorage["farq.current-student"]`: `src/lib/farq-api.ts:143-174`.
- Hermes provider/model selection and the optional tab-only gateway key are stored in browser storage: `src/lib/farq-api.ts:5-17`.
- The source onboarding UI is implemented in `src/components/onboarding/SourcesStep.tsx:16-149`.
- Evidence review is implemented in `src/components/onboarding/EvidenceReview.tsx:40-121`.
- The first roadmap can be generated either through the whole-roadmap endpoint or the current staged SSE flow: `src/components/onboarding/OnboardingChat.tsx:39-74` and `src/hooks/use-staged-generation.ts:35-104`.

### FastAPI and SQLite

FastAPI and SQLite are the authoritative Farq product store. The current models are in `services/api/app/models.py:20-145`:

- `Student`
- `StudentProfile`
- `StudentFact`
- `DataSource`
- `EvidenceItem`
- `ChatThread`
- `ChatMessage`
- `RoadmapVersion`
- `RoadmapProposal`
- `AgentRun`

Important invariant: SQLite is authoritative for student and roadmap state; Hermes memory is supplemental: `AGENTS.md:8-16`.

The current onboarding/evidence path is:

```text
POST /api/students
        ↓
profile basics
        ↓
add DataSource
        ↓
upload or sync source
        ↓
EvidenceItem(status="suggested")
        ↓
student reviews evidence
        ↓
StudentFact(source_kind="confirmed_evidence")
        ↓
profile brief
        ↓
Hermes roadmap proposal
        ↓
student accepts proposal
        ↓
new active RoadmapVersion
```

The source routes are in `services/api/app/main.py:331-440`. The source dispatcher is in `services/api/app/pipeline/evidence_step.py:41-53`.

Only confirmed evidence and explicit facts are included in the roadmap brief: `services/api/app/pipeline/brief_step.py:18-41`. Suggested evidence is excluded and can block readiness: `services/api/app/pipeline/brief_step.py:44-72`.

Roadmap structural changes are proposals. Hermes can submit one through `farq_submit_roadmap_proposal`, but only the FastAPI acceptance endpoint activates it: `services/api/app/main.py:1081-1124`.

### Hermes

Hermes is a local gateway with model fallback and session memory:

- Hermes requests are made from FastAPI, not from the browser: `services/api/app/hermes.py:434-506`.
- Coach/onboarding instructions are selected in `services/api/app/hermes.py:90-153`.
- Hermes tools call authenticated `/internal/hermes/*` endpoints: `services/api/app/main.py:1138-1193`.
- The plugin currently exposes verified context, roadmap, explicit-fact recording, evidence submission, and roadmap proposal tools: `.hermes/plugins/farq/__init__.py:9-166`.
- Hermes does not open SQLite and cannot accept a roadmap proposal.

Microsoft Graph must remain behind FastAPI. Hermes must never receive a Microsoft access token, refresh token, client secret, or unrestricted Graph client.

### Current deployment

- Native Windows runner: `scripts/dev.ps1`
- Native macOS/Linux runner: `scripts/firas_run_mac.py`
- Docker services: `docker-compose.yml`
- Browser/API proxy: `vite.config.ts` and `scripts/nginx.conf`
- Backend dependencies: `services/api/requirements.txt`
- Local environment template: `.env.example`

The current tree already contains uncommitted staged-roadmap work. Outlook work must be based on the current working tree and must not overwrite those changes.

## Security blockers that must be fixed first

The Outlook integration must not be enabled until these are addressed.

### 1. There is no student authentication

Student creation currently returns an ID and the browser remembers it. There is no password, session, or ownership check: `services/api/app/main.py:277-294`.

This is not sufficient for a mailbox connection. Any caller who knows a student ID could currently attempt to act as that student. Before OAuth:

- Add an authenticated server session.
- Use an `HttpOnly`, `SameSite` cookie.
- Enforce ownership on every student, source, thread, evidence, roadmap, proposal, and integration route.
- Do not authorize a request merely because it contains a student UUID.
- Bind Hermes tool calls to the originating run/student context rather than trusting an arbitrary model-supplied `user_id`.
- Protect the unauthenticated Hermes settings route, which currently writes `.env`: `services/api/app/main.py:892-915`.

For local development, a secure server-side session is sufficient for the pilot. For production, use a real identity provider and map the authenticated identity to a `Student`.

### 2. Secrets need a separate trust boundary

`DataSource.config_json` is returned to the browser by `source_dict()`: `services/api/app/main.py:123-132`. It is explicitly intended for non-secret values. It must never contain:

- Microsoft client secrets
- access tokens
- refresh tokens
- authorization codes
- raw Graph responses containing credentials
- arbitrary Graph URLs with sensitive query data

The current `.env` mechanism is suitable for local development configuration, but it is not a token vault. The current runners also load many environment values into child processes. Microsoft credentials should be passed only to the FastAPI process, never to Hermes.

### 3. Imported mail is untrusted input

Email bodies, calendar descriptions, attachments, links, and file names can contain:

- prompt injection,
- phishing instructions,
- malicious HTML,
- personal information,
- confidential university information,
- malicious attachments,
- arbitrary links that Farq should not fetch.

Imported content must be treated as data, never as instructions. It must not trigger tool calls, arbitrary web requests, shell commands, or attachment execution.

### 4. Existing roadmap safety must be tightened

The current `add_node` operation can accept a new node whose status is `done` or `in-progress`: `services/api/app/roadmaps.py:21-30`. This bypasses the intended “future-only changes” rule. Fix and test this before giving an agent access to mailbox-derived context.

### 5. Synchronization needs durable status

The current source job runs in a process-local thread: `services/api/app/main.py:374-393`. A full mailbox can take much longer than the current request timeout, and an API restart can leave a sync without a recoverable status. The Outlook connector therefore needs a durable sync-run record even if the first implementation uses FastAPI background tasks rather than an external queue.

## Microsoft identity and OAuth design

### App registration

Create a separate Microsoft Entra app registration for local development:

- **Supported account types:** accounts in the university organizational directory only.
- **Platform:** Web.
- **Proposed local redirect URI:** `http://127.0.0.1:8000/api/integrations/microsoft/callback`.
- The redirect URI must exactly match the value configured in Entra.
- Keep development and production registrations separate.
- Use a certificate in production. A client secret may be used for a localhost prototype only if it is stored server-side and never committed.
- Configure the university tenant ID explicitly. Do not use a broad multi-tenant authority for the first release.

If the university tenant requires administrator consent, show a clear consent-required state and provide the exact permissions to an administrator. Do not fall back to application permissions.

### Authorization flow

Use a server-side authorization-code flow with PKCE:

1. The browser calls `POST /api/students/{student_id}/integrations/microsoft/authorize`.
2. FastAPI verifies the current authenticated session.
3. FastAPI creates a cryptographically random state value and PKCE verifier.
4. FastAPI stores a one-time, short-lived OAuth state bound to the student, session, and source.
5. The browser is redirected to Microsoft.
6. Microsoft redirects to the registered callback.
7. FastAPI verifies state, redirect URI, tenant, and expiry.
8. MSAL exchanges the code for tokens.
9. FastAPI validates the Microsoft account by calling a fixed `/me` endpoint and stores the immutable Graph user ID.
10. The token cache is encrypted and associated with the correct student and Microsoft account.
11. The browser receives only a connection status, never a token.

The OAuth state must be one-time, short-lived, and tied to the authenticated student. A display name or arbitrary browser-supplied student ID is not an authorization mechanism.

### MSAL Python

The backend should use `msal.ConfidentialClientApplication` rather than manually implementing OAuth token refresh.

MSAL Python's default token cache is in memory. Because the Farq API must survive restarts, use a custom per-user serialized token cache. The Microsoft documentation recommends one cache per user for web applications.

The cache contains sensitive refresh material. Store it encrypted at rest with a server-only key. Keep the cache separate from the Hermes runtime and model-provider credentials.

Add `msal` to `services/api/requirements.txt`. Continue using the existing `httpx` dependency for fixed Microsoft Graph REST requests; the first release does not need the large Microsoft Graph SDK.

### Permissions

The initial delegated permission set should be:

```text
User.Read
Mail.Read
Calendars.ReadBasic
offline_access
```

Permission rationale:

- `User.Read` binds the Microsoft account to the Farq student.
- `Mail.Read` is required for full message bodies and attachment access.
- `Calendars.ReadBasic` provides primary-calendar event metadata without calendar body/attachment access.
- `offline_access` supports renewal; delegated permissions implicitly grant it in Microsoft identity flows, but it should be explicit in the application configuration if needed.

Use `Calendars.Read` only if the product specifically needs calendar event descriptions or event attachments. Do not request it just because it sounds safer; it is a broader permission than `Calendars.ReadBasic`.

Never request or implement write operations in the first release:

- `Mail.ReadWrite`
- `Mail.Send`
- `Calendars.ReadWrite`
- task write scopes
- application permissions such as `Mail.Read.All`

## Proposed data model

Add dedicated models rather than putting credentials or raw Outlook data into `DataSource.config_json`.

### `OutlookConnection`

Suggested fields:

- `id`
- `student_id`
- `data_source_id`
- `provider`
- `tenant_id`
- `graph_user_id`
- masked account label
- encrypted serialized MSAL token cache
- granted scopes
- connection status: `pending`, `connected`, `reauthorization_required`, `revoked`, `failed`
- last error
- last synced timestamp
- created/revoked timestamps

### `OAuthState`

Suggested fields:

- hashed state value
- student ID
- session ID
- source ID
- encrypted PKCE flow data
- redirect URI
- created/expiry/consumed timestamps

### `OutlookRecord`

Suggested fields:

- `id`
- `student_id`
- `connection_id`
- `resource_type`: `message`, `event`, `assignment`, `deadline`, `announcement`
- remote Graph object ID
- remote folder or calendar ID
- title/subject
- sender or organizer
- received/start/end/due timestamps
- normalized redacted data
- source URL
- provider modified timestamp
- content hash
- fetched timestamp
- review status: `suggested`, `confirmed`, `dismissed`
- optional projection to an `EvidenceItem`

The retained `normalized_data` should be allowlisted and redacted. It should not contain raw HTML, raw MIME, tokens, arbitrary URLs, or unrestricted recipient lists unless a specific field is approved and privacy-reviewed.

### `SourceSyncRun`

Suggested fields:

- `id`
- `connection_id` or `source_id`
- status: `queued`, `running`, `completed`, `failed`, `needs_attention`
- current phase
- pages processed
- records seen/created/updated/removed
- current folder/calendar
- opaque Graph delta link
- error category
- started/finished timestamps

On API startup, stale `queued`/`running` rows should be marked failed or resumable. A later manual sync can restart safely.

### Relationship to existing evidence

Do not turn every email or event into a `StudentFact`.

- A confirmed course, project, achievement, or education record can be projected into the existing `EvidenceItem` flow.
- A deadline, assignment, announcement, or calendar event remains a contextual `OutlookRecord`.
- Contextual records can be made available to the coach only after the student confirms them.
- A ticked review action is the only path that creates `StudentFact(source_kind="confirmed_evidence")`, preserving the repository invariant.

## API contract

Proposed routes:

```text
POST   /api/students/{student_id}/integrations/microsoft/authorize
GET    /api/integrations/microsoft/callback
GET    /api/students/{student_id}/integrations/microsoft
POST   /api/students/{student_id}/integrations/microsoft/sync
GET    /api/students/{student_id}/integrations/microsoft/sync-runs/{run_id}
DELETE /api/students/{student_id}/integrations/microsoft
GET    /api/students/{student_id}/outlook/records
POST   /api/students/{student_id}/outlook/records/decide
```

The existing `DataSource` routes can remain the visible source lifecycle, but OAuth credentials must be handled by the dedicated integration routes.

The API responses must never include:

- access tokens,
- refresh tokens,
- client secrets,
- raw MSAL cache data,
- raw Graph authorization responses,
- arbitrary provider URLs,
- unredacted imported bodies.

## Microsoft Graph synchronization

### Folder and message sync

For the first full mailbox sync:

1. List the mailbox's folders.
2. Recursively enumerate child folders.
3. For each folder, call the folder's message delta endpoint.
4. Follow the complete `@odata.nextLink` until `@odata.deltaLink` is returned.
5. Store the final delta link only after the complete round succeeds.
6. Process each page within response-size and runtime limits.
7. Detect and handle replayed records, updates, moves, and `@removed` records.
8. Resume or rebuild safely if a run is interrupted.
9. Reset the folder sync state and perform a full resync if Graph returns `410 Gone` or a missing sync state.

Microsoft's message delta API is folder-scoped. Therefore, a whole-mailbox sync requires folder enumeration and per-folder delta state. The opaque Graph links must be copied and followed exactly; the application must not inspect or reconstruct their tokens.

For full mailbox access, do not apply a hidden sender or subject filter. If the product later needs university-only or recent-only mail, make that a separate, explicit filter with a separate consent explanation.

### Message normalization

Use Graph `$select` to request only required fields. Request text content where possible using:

```http
Prefer: outlook.body-content-type=text
```

Normalize messages into allowlisted fields such as:

- subject
- sender domain/display name
- received timestamp
- folder provenance
- short redacted body excerpt
- attachment names/types/sizes
- Outlook web link
- extracted course/deadline/assignment candidates

Do not store arbitrary HTML or execute links found in messages.

### Attachments

`Mail.Read` permits reading message attachments. The first implementation should:

- fetch attachment metadata and content only through fixed Graph endpoints,
- enforce a strict per-attachment and per-run byte limit,
- allow only explicitly supported document types,
- use existing PDF/PPTX extraction paths where possible,
- never execute macros, scripts, binaries, or arbitrary document actions,
- never send raw attachment bytes to Hermes,
- discard the original after extraction,
- show attachment provenance in the review UI.

If a message has an unsupported or oversized attachment, retain only safe metadata and explain why content was not extracted. Do not silently claim that the full attachment was processed.

### Calendar sync

For the primary calendar:

1. Use a bounded calendar-view range for the initial sync.
2. Call `/me/calendarView/delta`.
3. Follow all `@odata.nextLink` responses.
4. Store the final `@odata.deltaLink`.
5. Handle deleted/cancelled events.
6. Preserve timezone information and normalize timestamps for roadmap use.
7. Show event provenance and last-sync time.

The first release should not read group calendars, shared calendars, or other people's calendars. Those require a separate scope and privacy design.

### Throttling and failures

The Graph client should:

- honor `Retry-After`,
- use exponential backoff when no retry header exists,
- cap page size and response size,
- time out individual requests,
- stop cleanly after a bounded retry budget,
- preserve the last successful snapshot if a refresh fails,
- mark reauthorization required for `invalid_grant`,
- avoid logging response bodies that may contain private mail content.

## Review and retention

### Review screen

Add a distinct Outlook review experience rather than forcing every message into the current achievement/course groups.

Each record should show:

- type,
- title,
- sender/organizer,
- date or due date,
- redacted excerpt,
- source folder/calendar,
- Outlook source link,
- last synchronized time,
- whether it is being used in the roadmap context.

Student actions should include:

- keep as confirmed university context,
- dismiss,
- optionally project as profile evidence,
- edit a safe title,
- open the original in Outlook.

Only confirmed context should be included in coach prompts and roadmap generation.

### Disconnect

Disconnect must:

- revoke or invalidate the Microsoft token cache where possible,
- delete the MSAL cache,
- delete pending OAuth state,
- stop future syncs,
- remove or mark unconfirmed Outlook records,
- preserve only records the student explicitly chose to keep as their Farq profile, unless the student requests full deletion,
- rotate or invalidate the relevant coach session where possible.

Hermes memory is supplemental and may retain data that was previously returned to the model. The current Hermes runtime does not provide a reliable complete memory-erasure API. The first release should therefore minimize what is sent to Hermes and document that disconnect is not equivalent to guaranteed deletion of historical model-provider or gateway memory.

## Hermes integration

Do not add:

- a generic Microsoft tool,
- a browser Graph tool,
- a terminal/web tool for Outlook,
- a tool that accepts arbitrary Graph URLs,
- a tool that can send or modify mail.

Add one narrow internal tool:

```text
farq_get_confirmed_university_context(user_id)
```

It should return only confirmed, normalized, student-owned records, bounded in count and length. It must not return tokens, raw messages, raw attachments, arbitrary folders, arbitrary queries, or other students' data.

The tool should be backed by an authenticated internal endpoint and bound to the current student/run context. The current plugin's arbitrary `user_id` pattern must be tightened as part of the authentication phase.

### Coach behavior

Update coach instructions so Hermes:

- uses university context for questions about deadlines, courses, assignments, and upcoming work,
- distinguishes confirmed context from unreviewed mailbox data,
- never claims that a message or attachment was reviewed when it was not,
- does not infer a student fact from an email automatically,
- does not send or modify Outlook data,
- submits a roadmap proposal when appropriate,
- waits for the existing FastAPI/student acceptance flow.

### Roadmap generation

Extend `build_profile_brief()` with a section such as:

```json
{
  "confirmed_university_context": {
    "upcoming_deadlines": [],
    "confirmed_assignments": [],
    "upcoming_events": []
  }
}
```

Only confirmed records belong in this section.

The first and staged roadmap generators should use confirmed deadlines to prioritize sequencing and learning-plan recommendations, but:

- no pending record is included,
- no active roadmap is mutated during sync,
- no model output is applied directly,
- completed/in-progress nodes remain protected,
- the student still accepts every roadmap proposal.

The existing proposal and acceptance flow remains the only roadmap activation path.

## Frontend changes

### Onboarding and My Data

Add an Outlook card to `SourcesStep` with a dedicated **Connect Microsoft Outlook** action instead of a free-form source value.

The card should explain:

- Microsoft will request mailbox and calendar read permissions.
- Farq will not send or modify messages/events.
- Full mailbox access is sensitive.
- Data is normalized and reviewed before affecting the coach/roadmap.
- The student can disconnect at any time.

The callback should return to the SPA with a safe status query parameter. The frontend should refresh the connection/source list and never read tokens from the URL.

### Connection status

Show:

- disconnected,
- authorization pending,
- connected account label,
- last sync,
- sync in progress,
- reauthorization required,
- sync failed.

A **Sync now** button should start a durable run and show progress. It should not poll the entire mailbox on every page render.

### Review UI

Add separate sections for:

- deadlines,
- assignments,
- announcements/course information,
- calendar events,
- other confirmed context.

The existing `EvidenceReview` screen should not be overloaded with every Outlook message. Profile-evidence projection can reuse its confirmation semantics, but contextual records need their own review state.

## Environment and deployment

Add only non-secret configuration names to `.env.example`, for example:

```text
MICROSOFT_CLIENT_ID=
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=
FARQ_TOKEN_ENCRYPTION_KEY=
```

For production, prefer certificate credentials and a secret manager. Do not put per-student access or refresh tokens in `.env`, Hermes configuration, Docker environment variables, browser storage, or source configuration.

The native runners must pass Microsoft client configuration only to FastAPI. Hermes must not inherit those values.

The API container must receive the non-secret Microsoft app configuration if Docker is supported. The Hermes container does not need Microsoft Graph credentials.

A separate development app registration should be used for localhost so production redirect URIs and credentials are not exposed locally.

## Files likely to change

### Backend

- `services/api/app/models.py`
- `services/api/app/schemas.py`
- `services/api/app/main.py`
- `services/api/app/pipeline/brief_step.py`
- `services/api/app/pipeline/evidence_step.py` or a new provider dispatcher
- `services/api/app/sources/microsoft.py`
- new OAuth/token-cache helper module
- `services/api/requirements.txt`
- `services/api/app/database.py`
- backend tests under `services/api/tests/`

### Frontend

- `src/lib/farq-api.ts`
- `src/components/onboarding/SourcesStep.tsx`
- `src/components/onboarding/EvidenceReview.tsx` or a new Outlook review component
- `src/components/onboarding/OnboardingChat.tsx` if generation context/status needs UI changes
- `src/components/footer-settings.tsx` for connection management

### Hermes

Only if the narrow context tool is implemented:

- `.hermes/plugins/farq/__init__.py`
- `.hermes/plugins/farq/tools.py`
- `services/hermes/SOUL.md`
- `.hermes/skills/farq-student-coach/SKILL.md`
- `docs/hermes-architecture.md`
- a dedicated threat-model document

The Hermes plugin should not receive Microsoft client configuration or tokens.

### Documentation

Add or update:

- `docs/microsoft-integration.md`
- a Microsoft/Graph threat model
- `docs/handoff.md`
- `docs/future-work.md`
- `README.md`
- local setup instructions

## Implementation phases

### Phase 0: security and safety foundation

- Add student sessions and ownership enforcement.
- Bind Hermes tools to authenticated run context.
- Protect settings and credential routes.
- Replace development defaults.
- Fix the `add_node` completed/in-progress status bypass.
- Add tests for existing SQLite databases and new tables.
- Document Microsoft OAuth and mailbox threat boundaries.

### Phase 1: OAuth and connection lifecycle

- Add `msal` and encrypted per-user token-cache support.
- Add `OutlookConnection` and `OAuthState`.
- Add authorize/callback/status/disconnect routes.
- Add exact localhost redirect URI support.
- Validate university tenant and Microsoft account identity.
- Add a safe disconnect/revocation flow.

### Phase 2: manual Graph synchronization

- Add Outlook source registration.
- Add mailbox folder enumeration.
- Add per-folder message delta synchronization.
- Add primary-calendar delta synchronization.
- Add attachment safety and extraction policy.
- Add durable sync-run status and progress.
- Add throttling, retry, timeout, and reset handling.

### Phase 3: review and context

- Add normalized Outlook record storage.
- Add review/dismiss/confirm actions.
- Project only approved profile-relevant records into evidence.
- Extend the profile brief with confirmed university context.
- Add the narrow Hermes context tool.
- Update coach instructions.

### Phase 4: roadmap integration

- Pass confirmed context to whole and staged roadmap generation.
- Ensure pending Outlook records never enter prompts.
- Keep roadmap changes proposal-only.
- Test student acceptance and rejection.
- Test that completed/in-progress nodes remain protected.

### Phase 5: verification and pilot

- Run backend tests, lint, and frontend build.
- Test with a real university account using a dedicated development app registration.
- Verify consent, token reauthorization, full initial sync, incremental manual sync, review, coach answers, roadmap generation, acceptance, and disconnect.
- Inspect logs and API responses for token or raw-message leakage.
- Test a large mailbox and interrupted sync.
- Test prompt-injection messages and malicious attachment names.
- Document known limitations before enabling the connector for other students.

## Test matrix

### OAuth

- Valid state completes once.
- Expired state is rejected.
- Replayed state is rejected.
- Cross-student state is rejected.
- Redirect URI must exactly match configuration.
- University tenant restriction is enforced.
- Personal Microsoft account is rejected.
- Invalid client credentials are sanitized.
- Token cache is encrypted.
- Disconnect removes the token cache.
- Tokens never appear in API responses, logs, browser storage, or Hermes input.

### Graph synchronization

- Folder enumeration handles nested folders.
- Pagination follows the complete server-provided link.
- Empty pages and duplicate delta records are handled.
- Message updates and moves are idempotent.
- Deleted records are marked appropriately.
- Graph `410 Gone` triggers a full resync.
- Calendar event deletion is handled.
- `Retry-After` and exponential backoff are respected.
- Timeout and provider 5xx errors preserve the last good snapshot.
- A restarted sync can resume or safely restart.

### Privacy and safety

- Raw HTML is not sent to Hermes.
- Email content is treated as untrusted data.
- Prompt injection cannot trigger tools or roadmap writes.
- Unsupported attachments are not executed.
- Oversized attachments are rejected or paused.
- Links inside messages are not fetched.
- Redaction removes configured identifiers.
- Raw mailbox data is not permanently archived.
- Confirmed/unconfirmed deletion behavior matches the retention policy.

### Product invariants

- Sync creates no `StudentFact`.
- Suggested records do not enter the profile brief.
- Confirmed records enter the brief only after review.
- Outlook sync creates no active roadmap.
- Hermes can submit only pending proposals.
- Only FastAPI acceptance activates a proposal.
- Completed/in-progress nodes cannot be changed or removed.
- Cross-student source and record access is impossible.

## Non-goals for the first release

- No email sending, replying, forwarding, or drafting.
- No calendar/event/task creation or editing.
- No automatic marking of messages as read.
- No arbitrary Graph URL access.
- No application-only mailbox access.
- No personal Outlook accounts.
- No group/shared calendars.
- No background scheduler.
- No Microsoft Graph change-notification webhooks.
- No raw mailbox archive.
- No direct browser-to-Microsoft token handling.
- No generic Microsoft/Graph Hermes tool.
- No automatic roadmap mutation from email content.

## Microsoft research references

- [Microsoft identity platform authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [MSAL Python: acquire tokens](https://learn.microsoft.com/en-us/entra/msal/python/getting-started/acquiring-tokens)
- [MSAL Python: token-cache serialization](https://learn.microsoft.com/en-us/entra/msal/python/advanced/msal-python-token-cache-serialization)
- [Register a Microsoft Graph application](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)
- [Add a redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Least-privileged access guidance](https://learn.microsoft.com/en-us/entra/identity-platform/secure-least-privileged-access)
- [List Outlook messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
- [Message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [List message attachments](https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0)
- [Get attachment content](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0)
- [Calendar view](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0)
- [Event delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0)
- [Delta-query overview](https://learn.microsoft.com/en-us/graph/delta-query-overview)
- [Microsoft Graph throttling](https://learn.microsoft.com/en-us/graph/throttling)
- [Graph change-notification webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)

## Final recommendation

Implement this as a server-side, delegated, read-only Outlook connector behind a normalized university snapshot. Keep Microsoft completely outside Hermes's tool surface. First add authentication and safe token storage, then add manual full-mailbox/calendar synchronization, then connect only reviewed Outlook context to the coach and roadmap proposal flow.
