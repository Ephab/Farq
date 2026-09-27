# Outlook threat model

## Boundaries and authorization

Browser -> same-origin FastAPI -> Microsoft identity / fixed Graph read endpoints.
Laya runs in the API worker process and has no tools. Mailbox tables are separate
from student facts, public opportunities, team events and Hermes sessions.

The legacy demo student UUID is not authentication. Microsoft mailbox identity is
derived from MSAL-validated tenant/object claims and matched to Graph `/me`. A new
private User is created without attaching arbitrary student IDs. Only an HttpOnly
seven-day server session authorizes mailbox routes through `current_user()`.
Unknown, expired and forged sessions fail closed. Demo headers cannot impersonate
Microsoft users. Existing non-mail student APIs remain a demo, not production auth.

OAuth uses MSAL's authorization-code flow with PKCE and nonce, a random browser
cookie, ten-minute encrypted flow storage and an atomically consumed state hash.
Callbacks must match both state and browser cookie. The configured tenant is a
specific UUID. No personal, shared, archive or application-wide mailbox grant is
requested. Writes require the exact configured Origin to protect cookie sessions
from CSRF; no wildcard-origin policy authorizes mailbox operations.

Only the configured same-origin callback can notify the popup opener. The browser
checks both message origin and popup source, then fetches actual server status.
Callback HTML has a nonce CSP, no-referrer policy and no token-bearing script.
Use HTTPS except on localhost. Host compromise or same-origin XSS can still operate
the user's session; this is outside the protection of HttpOnly cookies alone.

## Secrets and transport

Token caches and OAuth flow payloads are Fernet-encrypted with a server-only key.
Session/state tokens are stored hashed. Secrets are never returned in source records
or public APIs. Native runners exclude the Microsoft secret and encryption key from
Hermes child environments; Docker supplies them only to the API container.
Do not log callback query strings, request cookies, Graph responses or MSAL caches.
Callback codes still traverse Microsoft and the local reverse proxy; disable access
logs or redact that route at every proxy layer. The provided API container disables
Uvicorn access logs.

Graph requests only accept HTTPS graph.microsoft.com paths under the connected
account's mailFolders boundary. Redirects, other accounts and arbitrary URLs are
rejected. Timeouts, 8 MB response caps, bounded pages, server-side cursors and
Retry-After scheduling prevent unbounded network operations. No mail link is fetched.

## Untrusted content and retention

Mail can contain phishing and prompt injection. HTML is reduced to text without
fetching images; React escapes all displayed excerpts. Outlook links are HTTPS and
restricted to Microsoft Outlook hosts. Script/style text is removed. Attachments
are neither downloaded nor executed. Redaction minimizes common identifiers but
is not complete anonymization. The database contains private normalized content.

The model only emits bounded labels/probabilities, validated by the existing local
classifier. Unsupported languages and long/uncertain messages remain reviewable.
No output invokes tools, changes a roadmap, creates StudentFact, or grants retention.
No raw message text goes into model logs or error messages. Cached records expire
after 30 days and are excluded from reads immediately after expiry.

Each worker holds an expiring database lease. Every write rechecks the connection's
generation and lease after external calls/inference. Pause, disconnect and reconnect
invalidate old workers. A worker cannot restore erased messages or token material.
Delta pages are committed only after processing; duplicate deliveries are deduped by
message ID and normalized content hash. Full resync reconciles records absent from
the new baseline. Mail moves use immutable IDs, with tombstones hidden from views.

## Remaining limits

This is a local pilot, not a completed production account system. No automatic demo
profile migration or Hermes mailbox tool is provided. Protect the host and database,
back up the encryption key separately, use a production credential lifecycle, and
add reverse-proxy rate limits before exposing OAuth publicly. Sync leases recover
after at most ten minutes; requests are bounded but model time depends on hardware.
Tests use synthetic Microsoft responses; live university consent and deployment on
macOS/Linux remain to be verified on the target machines.
# Classic Outlook desktop provider

`OUTLOOK_PROVIDER=desktop` opts into native Windows COM automation. It requires
loopback requests, an exact localhost Origin on writes, a random local pairing
code and explicit browser consent before inspecting the default Outlook store.
The pairing code is not an API response and is not committed. This mode is for a
single trusted Windows user; do not expose its dev servers over a LAN or tunnel.
Same-user malware and local administrators are outside this boundary.

Each worker invocation initializes/releases COM on its own thread. The store ID
is pinned at connection time; switching the default mailbox fails closed. The
adapter only calls read APIs: no Send, Save, Move, Delete, attachment extraction,
security-setting changes, or programmatic-access prompt suppression. Outlook's
Object Model Guard and university policy still apply. COM grants broader powers
than the adapter uses; this is application-enforced read-only behavior.

Snapshot cursors contain EntryIDs, never message bodies. Unprocessed bodies exist
only during local normalization/classification; complete cleaned and redacted text
is cached for 30 days at the user's request, with no 1,800-character truncation.
Metadata scans reconcile deletions and
process at most 20 IDs per page. Durable worker leases and disconnect generation
checks apply equally to both providers. Desktop access has no Entra token cache.
The existing controls and limitations below describe the Graph provider unless
explicitly shared; desktop ownership comes from pairing, not Microsoft OAuth.

## Integrated public-client sign-in and optional Q&A

Public device flows use a random HttpOnly browser cookie, hashed lookup keys,
encrypted device codes with expiry, server-side polling intervals and one-time
consumption. Graph `/me` supplies the private mailbox identity; browser student IDs
never authorize mail. Temporary access tokens use the same encrypted cache and
fail closed after expiry. Public-client refresh tokens rotate inside the existing
sync lease/generation boundary. Old demo-student token rows are not adopted.
Mailbox sessions are resolved by `current_user()` only for `/api/outlook/*`, so
team/Coach demo identity remains unchanged and cannot claim a private mailbox.

Only an explicit `/api/outlook/chat` request sends selected, owned, unexpired mail
to AI. Context above the fixed bound is rejected, not silently cut. The browser
shows provider disclosure and requires consent. All mail is labeled untrusted.
A fresh Q&A session is insufficient isolation on its own: the separate email
Hermes runtime has an empty API toolset, disabled memory, no Farq plugin or skills,
no Farq internal token, and no Coach state mounted. Supplied runners provision that
runtime; deployments must preserve these boundaries. No generic tools are enabled.
Q&A answers are displayed as text and do not become StudentFacts or proposals.

The email gateway can retain session transcripts and the chosen/fallback cloud
providers can retain requests under their policies. They are outside the 30-day
SQLite mail cache and are not erased by Farq disconnect. Protect or remove the
separate runtime's history according to the deployment's retention policy.
