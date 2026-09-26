# Outlook triage and university context

Status: proposed for product approval; no mailbox integration is enabled.
Date: 2026-09-26
Branch: `codex/outlook-integration`, isolated worktree based on `feat/group-projects-hermes`.

Follow-up: the user selected `convaiinnovations/laya-typed-decisions` for the local
classifier implementation. See `local-email-classifier.md` for setup, usage and
its English-only/domain-calibration limitations. The provider comparisons below
remain research background; the Outlook connection and UI are still proposed.

## Outcome

Students connect their university Microsoft account through a sign-in popup. Farq
incrementally reads their mailbox, classifies each new or changed message with a
small specialist model, and shows useful items in Important and Today. Hermes
retrieves bounded, sourced context when needed rather than ingesting every email.

This proposal updates the earlier `outlook.md` design. That document proposed
manual-only sync, calendar access and attachments in its first release. Here,
background sync is proposed to satisfy the current request; calendar and attachment
extraction are separate follow-ups. Both are product decisions, not implemented behavior.

## Repository findings

The review covered the repository layout and the main frontend, API, identity,
storage, onboarding/evidence, roadmap, Hermes/plugin, team authorization,
opportunity and deployment paths. This is an architecture review, not a claim that
every source line or test has been audited.

- `src/App.tsx` selects views in React state. Home already renders
  `src/components/dashboard/TodayView.tsx`, with roadmap progress, pending evidence,
  proposals and practice. Extend it rather than replacing it.
- `src/lib/farq-api.ts` remembers an unauthenticated student ID in localStorage.
  `services/api/app/identity.py` provides the required `current_user()` seam, but
  currently trusts the demo `X-Farq-User` header. Many main API routes only check
  that a student exists; they do not establish ownership.
- `models.py`, `sources/`, and `pipeline/review_step.py` already separate suggested
  evidence from confirmed facts. `pipeline/brief_step.py` only uses confirmed
  evidence and stated facts. Mail classifications must preserve this separation.
- `hermes.py` runs the gateway with provider fallback; the plugin authenticates
  with one internal token and accepts model-supplied student IDs. That is not a
  sufficient per-student mailbox authorization boundary.
- `opportunities/service.py` ingests a public global feed and recomputes matches
  for every student. Private mailbox opportunities must not enter that shared feed.
- Team policy distinguishes instructor access from private chat. Mail stays private
  to its owner, including in team coach runs, teammate cards and event streams.
- Native launchers share environment configuration with child processes. Microsoft
  and classifier secrets must be explicitly excluded from the Hermes environment.
- The existing Outlook plan correctly identifies missing sessions and durable sync.
  Its line references and the handoff's description of Home as a placeholder are stale.

## Proposed first release

1. **Connect Outlook:** university/work accounts; Microsoft consent popup, blocked-popup
   redirect fallback, connected account label, last sync and reconnect handling.
2. **Important:** exams, coursework, deadlines, required university actions and relevant
   opportunities. Each card shows source, received time, classification reason/category,
   uncertainty and an Open in Outlook link. Pin, dismiss and correct classification locally.
3. **Today:** extend the existing dashboard with dated actions, overdue items and new
   important mail. Receiving an email today does not imply its action is due today.
4. **Needs review:** ambiguous dates, uncertain classification and truncated/unsupported
   content remain visible; provider failures never silently classify mail as unimportant.
5. **Search and ask Hermes:** student-scoped search of retained normalized records;
   explicit Use with coach approval for context, with citations to originals. Saving
   profile evidence still requires the existing tick-to-confirm review.
6. **Connection controls:** Sync now, pause automatic sync, processing-provider choice,
   clear stored mail data and disconnect. Read-only Microsoft permissions.

No send/reply, mailbox moves, mark-read changes or automatic roadmap acceptance.
Calendar integration, attachment text extraction, semantic vector search and suggested
roadmap changes from mail are optional follow-ups. Attachment metadata can be shown
in v1, with an explicit indication that attachment contents were not analyzed.

## Processing pipeline

```text
Microsoft sign-in + delegated consent
                 |
FastAPI token vault -> Microsoft Graph folder/delta sync
                 |
normalize text -> redact -> split long messages with coverage tracking
                 |
Jev OR local classifier (no tools)
                 |
validated labels + uncertainty + source spans
                 |
deterministic policy -> private SQLite records -> Important / Today / Review
                 |
student-approved context -> bounded Hermes retrieval -> sourced answer
                 |
explicit evidence review / roadmap proposal acceptance when applicable
```

Initial mailbox traversal must cover nested folders, paginate durably and display
progress. Process newest items first where supported without silently excluding old
mail. Explain precisely which folders/resources are supported; do not promise access
to separate archive or shared mailboxes under a primary-mailbox connection.

Use one durable cursor per folder, immutable message IDs, idempotent page commits,
reconciliation of moves/deletions, stale delta recovery and Retry-After backoff.
Validate every continuation URL against the fixed Graph origin and allowed resource
paths; disable redirects. Treat cursor values as opaque and keep them server-side.

Proposed automatic cadence: every 15 minutes while the local API/worker is running,
plus Sync now. Sleeping/offline machines cannot sync; display freshness honestly.
Use persisted job leases, bounded batches and crash recovery, not only a process lock.
Disconnect increments a connection generation; in-flight jobs must check it before
committing or publishing, so deleted data cannot reappear after disconnect.

## Classifier decision

Jev is a good architectural fit for closed decisions: category, action required,
time sensitivity, likely lasting relevance and uncertainty. It is not a general
summary-writing replacement for Hermes. Ask independent questions together for each
message. Date extraction needs source spans and deterministic validation; ambiguous
dates/timezones go to review, never to an invented deadline.

Official documentation currently lists `jev-1.13.0`, hosted at TypeSafe's
`POST /v1/systemone`, at $0.042 per million input tokens. An illustrative 10,000
messages at 1,000 total input tokens each is $0.42 for classification, excluding
retries, longer questions, embeddings and any summarization. English is its strongest
language; Arabic and mixed-language university mail need a separate evaluation.
Sources: [models](https://docs.typesafe.ai/models),
[API](https://docs.typesafe.ai/api),
[limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

A local alternative to benchmark is
[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B), served behind a fixed local
endpoint with schema-constrained output. It has downloadable weights; equivalence
to Jev's accuracy, speed or confidence calibration has not been demonstrated here.
[Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) is a smaller experimental
candidate; its own card positions it for prototyping and task-specific work.

Recommended default pending preference: local classification, optional Jev after
explicit provider disclosure. Do not silently fall back from local to cloud. A local
classifier does not make Hermes local: selected coach context can still reach the
configured Gemini/NIM/Hugging Face provider. Show both processing boundaries.

Evaluate both on synthetic or separately consented, labeled Arabic/English mail:
urgent-message recall, false-important rate, date precision, uncertainty coverage,
latency, memory and cost. Pin model/policy versions and retain student corrections.
Treat local-model self-reported confidence as uncalibrated until evaluated.

## Memory and retention policy

Importance and retention are separate decisions. An urgent room change is temporary;
a nonurgent course guide may be useful for a semester. The model suggests features;
code owns storage, limits and expiry. The following durations are proposed defaults.

| Layer | Contents | Proposed lifetime / authority |
| --- | --- | --- |
| Raw input | Text being normalized/classified | Transient; no persistent full mailbox mirror |
| Dedup cache | Student/connection/message hash, model and policy version, labels | 30 days; no raw body; purge on disconnect |
| Short-term context | Redacted excerpt, source span, action/date candidate | 30 days or seven days after resolved deadline, whichever is later, capped at 180 days unless explicitly kept |
| Longer-term context | Student-approved course/reference notes with provenance | Until student deletes or selected expiry; SQLite authoritative |
| Profile facts | Explicitly reviewed evidence | Existing StudentFact rules; classifier cannot write these |
| Search index | Derived text index; optional vectors later | No longer than source retention; never authoritative |

For v1, start with SQLite text search. A VDB is an indexing choice, not a separate
truth or automatic long-term memory store. If added, filter by student/connection
before ranking, verify ownership after retrieval and cascade deletion to embeddings.
Keep hashes/cursors needed for incremental sync under a documented connection lifecycle.

Suggested records can appear in Important/Today with labels before factual review.
Only student-approved context reaches the coach in the first release. Deadline
confirmation is distinct from confirming a profile achievement. Imported mail must
not inflate onboarding evidence counts or block onboarding with thousands of messages.

## Authentication and threat boundaries

- Add authenticated server sessions through `current_user()`; never use the demo
  header or a localStorage UUID as proof of mailbox ownership. Keep demo mode isolated
  and refuse real Outlook connection there. Bind Microsoft identity to tenant/object
  IDs; do not claim an existing student merely from its name, email or UUID.
- Protect all paths that can expose retained mail indirectly, including coach chat,
  evidence, profiles, proposals and run output. Protect credential settings routes.
  Preserve team policy and replace the SSE demo query identity with session identity
  in authenticated mode.
- Use MSAL authorization-code flow with PKCE, nonce and expiring single-use state,
  bound to the initiating browser session. Rotate session after sign-in. HttpOnly,
  SameSite cookies, Secure in HTTPS deployments, origin/CSRF checks on writes.
- Popup completion sends only a status notification to the exact configured origin;
  validate event source and origin in the parent and refetch server status. Handle
  cancel, popup close, expiry, tenant rejection and admin-consent-required states.
- Request delegated `Mail.Read` plus identity/refresh scopes needed for the chosen
  flow, not application permissions. Calendar access requires a separate feature and
  consent. University tenant policy may require administrator approval.
- Encrypt per-user token caches at rest; keep key material outside the database and
  out of Hermes. Never return credentials in DataSource configuration, logs or UI.
- Classifier has no tools. Email HTML, URLs and attachments are untrusted; render
  escaped text and never fetch embedded links/images. Prompt-injection classification
  is advisory; authorization and write restrictions are enforced in code.
- Hermes mail retrieval must use trusted run identity/capability established outside
  model arguments. Do not grant mail access through the existing global-token plus
  arbitrary-user-ID pattern. Verify runtime support; until available, inject bounded
  approved context server-side instead of exposing a mailbox tool.
- Put a total retrieval budget on each coach run (proposed 10 records / 6,000 tokens),
  including repeated calls. Never allow unbounded browsing of the mailbox by Hermes.
- Disconnect stops workers and deletes tokens, cursors, caches and derived mail
  records/indexes. Explicitly retained evidence needs a separate clear deletion choice.
  Explain Microsoft-side consent revocation separately. Do not promise erasure of
  content already sent to model providers or historical Hermes memory.

References: [Microsoft authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[delegated permissions](https://learn.microsoft.com/en-us/graph/permissions-reference),
[folder message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0).

## Implementation sequence and acceptance

1. Sessions, ownership enforcement, token isolation and documented threat model.
2. Dedicated `outlook/` backend package: encrypted connections, OAuth state,
   folder cursors, private mail records, classifications, durable jobs and user actions.
3. Graph sync with fixture-based tests: multiple pages/folders, duplicates, moves,
   deletion, 410 reset, 429 retry, restart and disconnect races.
4. Provider-independent triage schema and policy tests: uncertain/malformed outputs,
   Arabic/English fixtures, long-message coverage, provider outage, source-backed dates,
   expiry and zero automatic StudentFact creation.
5. `src/components/outlook/` workspace and `src/lib/outlook-api.ts`; small integration
   edits in App, Today and My data. Accessible popup fallback and loading/error/empty states.
6. Bounded approved coach context, with cross-user, team/instructor and repeated-call
   budget tests. Keep proposal acceptance and started-node protections intact.
7. Backend suite, frontend tests/build, visual review and live Microsoft pilot.

Live verification needs a university tenant/app registration, exact redirect URI,
server-side credentials, encryption key and student sign-in. Do not collect secrets
in chat. Model quality and live OAuth have not been tested in this proposal stage.

## Approval scope

Approve or revise the six first-release features, the processing provider preference,
15-minute local background sync and retention defaults. Calendar, attachment content
and VDB remain follow-ups. Approval is requested because the user asked to review
proposed features before implementation, not because a skill requires it.
