# Outlook threat model

## Authorization

Mailbox identity is separate from demo student/team IDs. `current_user()` recognizes
a private HttpOnly mailbox session on `/api/outlook/*` and personal Coach message
creation (for scoped mail grants only). Demo headers cannot
impersonate mailbox users. Every mail read, edit and Q&A request checks ownership,
connection status and record expiry. Only classic Outlook and temporary Graph-token
connections are accepted; retired sign-in connections cannot read or sync mail.

Classic Outlook is a local, single-trusted-OS-user feature. Setup passively checks
Windows COM registration and generates a server-only `OUTLOOK_LOCAL_TOKEN` in `.env`.
It does not launch Outlook. After the student checks the browser consent checkbox,
a same-origin POST creates a random two-minute HttpOnly SameSite=Strict cookie.
The database stores an HMAC digest keyed by the local secret. Connecting requires
explicit `accepted=true`, an exact Origin, a loopback client and localhost Host,
and atomically consumes that cookie once before COM is called. The local secret
never reaches the UI. Replays, missing/expired cookies, hostile Origins and DNS
rebinding Hosts fail before mailbox access. Disconnect invalidates pending consent.

Graph identity comes from `/me` using the provided Microsoft-issued token; browser
student IDs cannot claim accounts. Tokens require User.Read/Mail.Read consent and
are subject to Microsoft policy. There is no app-registration flow, device code,
refresh-token exchange, or way for setup to mint a Graph access token.

## Secrets and isolation

Setup generates missing gateway, internal API, encryption and supported-device
secrets without printing them; preserves existing valid keys; and never commits
`.env`. Temporary Graph access tokens are Fernet-encrypted in SQLite, never copied
into `.env` or API responses. The frontend development server does not inherit
provider credentials. Hermes does not inherit mailbox secrets. Coach and email Q&A share the gateway,
its Farq tools and memory; mail access is enforced by the API, not the prompt.

Origin checks protect all writes. Native servers bind to loopback. The default
HTTP/localhost deployment assumes a trusted local OS user. Same-user malware,
local administrators and same-origin XSS are outside these defenses. Remote Graph
deployments require HTTPS and proper host/proxy/session hardening.

## Read-only adapter and sync

Classic Outlook uses COM initialized/released on each worker thread. It pins the
default StoreID and only reads mail folders/items; it never calls Send, Save, Move,
Delete, extracts attachments or suppresses Outlook security prompts. COM itself
has broader capabilities: read-only behavior is enforced by the adapter.

Graph requests accept fixed HTTPS graph.microsoft.com paths for the connected
account's mailFolders. Redirects, other accounts and arbitrary URLs are refused.
Requests have timeouts and an 8 MB cap; pages and retry/backoff are bounded. Tokens
are temporary and cannot refresh; expiration/rejection requires reconnecting.

Database leases and generation checks guard every worker write after external I/O
or inference. Pause, reconnect and disconnect invalidate old work, preventing erased
messages or credentials from being restored. Resumable cursors and content hashes
avoid reclassifying unchanged text. Reads exclude expired records immediately.

## Untrusted content and Q&A

HTML becomes plain text, React escapes it, and the app never fetches mail links,
remote images or attachments. Cleaning removes known banners and tracking noise.
Redaction is best-effort, not anonymization. Full cleaned bodies remain private in
SQLite for 30 days. Classification is local; model labels never grant tools,
retention, student facts, team events or roadmap authority.

Selected-email Q&A sends only the explicitly consented selection. Coach mailbox
search requires a separate opt-in on the private mailbox session. Each Coach run
gets an unpredictable expiring capability, stored hashed, bound to its running
AgentRun, live mailbox session, connection and generation. Tools also require the
internal service credential; a student ID or item ID alone cannot retrieve mail.
Search returns bounded snippets; reads paginate full cleaned bodies. Expired,
removed and foreign rows are excluded. Revocation deletes pending grants and is
checked on every read; it cannot recall text already sent to the model.

Email Q&A now uses Coach's gateway and runtime home, with its available tools and
memory. Prompt instructions label mail untrusted and prohibit following mail's
instructions or turning it into facts; these instructions are not a sandbox.
Shared memory/tool prompt-injection risk is higher than an isolated gateway.
Existing proposal acceptance and fact-source rules still apply. No generic web,
terminal or file access is enabled by this integration. Only cached mail is read.
This remains a trusted single-user local demo: Coach thread endpoints are not yet
production-authenticated, and email-derived Coach replies persist in chat history.
Deployments with multiple untrusted users need proper Coach authentication before
exposing mailbox search. Teams are never granted mail capabilities.

Gateway/provider transcripts can outlive Farq's cache and are not erased by
mailbox disconnect. Protect those stores under the deployment's retention policy.
Tests use synthetic mail and mocked Microsoft responses. Live Outlook approval,
organization restrictions and native macOS setup still require target-device checks.
