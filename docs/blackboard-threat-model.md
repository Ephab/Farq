# Blackboard sync threat model

Waypoint signs in to the student's IAU Blackboard with their own credentials in headless Chromium
and runs the shared extractor in `BB-Extension/src`. Code: `services/api/app/blackboard_sync/`.

## 1. What is stored and where

- `blackboard_connections.password_enc` and `session_enc` are Fernet-sealed with
  `WAYPOINT_TOKEN_ENCRYPTION_KEY` (the same seal/unseal as the Outlook connector). Without a key the
  session is kept only in process memory and nothing is remembered across restarts.
- Attachment bytes stay in memory only. Limits: 60 files, 15 MB each, 40k characters of text, and a
  zip-bomb guard (100 MB uncompressed, 2000 entries).
- Redacted extracted text is kept in `blackboard_content_items`. Passwords are never returned by the
  API, logged, or chained into exception messages.
- The remote file catalog (`blackboard_attachments`) stores filenames, course/content IDs, paths,
  sizes and observed Blackboard URLs, never original bytes. The owner-facing collection also keeps
  a redacted structured snapshot on the connection (without user identity, cookies or debug samples)
  so folders, events, attempts and endpoint diagnostics remain inspectable. It never becomes facts.

## 2. Blast radius

The IAU password also unlocks the student's IAU Microsoft account (mail, Teams). Anyone holding both
the SQLite file and `.env` can recover it. That is acceptable only because Waypoint runs on the
student's own machine, where those files are already theirs. A hosted deployment must not enable
remembered logins.

## 3. What the sync can do

- Requests are GET-only, plus the AD FS sign-in form submit.
- On the IAU Blackboard origin, sync may click Continue only on the exact "Additional device
  logged out" notice with the single-active-session explanation. It then rechecks the authenticated
  API. Other Continue buttons, MFA and consent screens remain manual extra-verification steps.
- Embedded Ultra files are catalogued from `data-bbfile` metadata, including their filenames and
  observed same-origin resource URLs. That metadata is untrusted; external URLs are excluded.
- An attachment download is started only for a URL on the Blackboard origin. Redirects are followed
  (Playwright's request context, up to 20 hops, cookies sent only under normal cookie rules), and the
  body is kept only if the final URL is on the Blackboard origin or is `https://`. Intermediate hops
  are not checked, and a final `https://` URL on another host is accepted (Blackboard may hand files
  off to a storage host).
- The download phase has a 180 s budget (`DOWNLOAD_BUDGET_SECONDS`); after it no new download
  starts and what was already read is kept. With the 8-minute extract timeout this bounds a sync.
- A typed password is remembered only after this run submitted it to AD FS and the sign-in
  succeeded; a sync that signed in with the saved session never stores the typed password.
- It reads only the signed-in student's own data, with their own entitlements.
- Hermes never sees credentials. It gets Blackboard data only through the existing read tools, behind
  the connector switch (enforced in the internal API routes).
- On-demand file downloads use only a catalog record owned by the caller and their saved session;
  the browser cannot supply a URL or cookies. The connector switch is checked server-side. No login
  or password retries happen during download. Initial requests must stay on the HTTPS IAU Blackboard
  origin. Redirects may also go to IAU's verified file tenant, `alt-685da65a9aa3e.blackboard.com`,
  with a six-hop bound; every other host, HTTP URL, non-standard port and URL with embedded
  credentials is rejected. This is an exact allowlist, not a wildcard for Blackboard or arbitrary
  storage services. Storage downloads use a separate request context without the IAU login state;
  only the signed redirect URL authorizes them. Signed URLs and response bodies are never logged.
  Responses are capped at 15 MB, HTML sign-in pages are rejected, and originals are returned with
  `Cache-Control: no-store` and attachment disposition. They are never saved to the server's disk.
  The client keeps one opened original in memory, generates previews in the browser, and writes a
  local copy only through the student's explicit "Save to device" action.

## 4. Lockout safety

- A saved password that fails once is wiped and the retry loop stops.
- 3 typed (manually entered) failures wipe the saved password and session.
- Network errors, extraction failures and crashes do not count as login failures; they retry in 1 hour.
- Credentials sent during a running sync are rejected with 409. Syncs are single-flight.

## 5. The forget path

`DELETE /api/students/{id}/blackboard/connection`, surfaced as the "Forget my login" button on the
My data Blackboard card. It removes the sealed password and session.

## 6. Untrusted content

Announcement, content-item and attachment text is untrusted data for Hermes and never becomes a
`StudentFact`. Only course-level records become `suggested` evidence, which still needs the student's
review tick.

## 7. Rejected alternatives

- Extension-only: needs a manual install and click each time, which fails the seamless requirement.
- Official REST/3LO: needs IAU admin registration of an application.
- Pure HTTP replay of SAML: fragile against AD FS changes, and would need a second extractor.

## 8. Owed

- If IAU adds MFA, the sync fails with `extra_verification`; supporting MFA is a separate design.
- Hosted multi-user deployments need a different secret store.

## 9. "Extra step" diagnostics

When IAU shows something other than Blackboard after sign-in (MFA, password change, consent,
a changed sign-in page), the sync records the page title and `host/path` (never the query string,
which can hold a SAMLRequest) in `stage_detail`, and saves a screenshot to
`.blackboard-debug/<student>.png` on this computer (git-ignored, never in the DB or a log). The
screenshot can show the username but not the password (password fields are masked). Only the owner
can fetch it (`GET /api/students/{id}/blackboard/sync/screenshot`); the next sync and "Forget my
login" delete it. Setting `WAYPOINT_BB_HEADED=1` before `run.bat` opens the sign-in in a visible
Chromium window so the student can watch it.
