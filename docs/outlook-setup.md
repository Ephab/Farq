# University Outlook setup

The integration keeps Laya local. It adds Microsoft sign-in, a private primary-mailbox
cache, resumable per-folder delta sync, and Emails views: Important, Today,
Needs review, All mail and Dismissed. Home includes a Today panel; onboarding and My
data also offer connection controls. No email is sent, marked read, moved or deleted
in Microsoft. No calendar or attachment content is read.

## Classic Outlook on Windows (no Entra registration)

Use this provider for a native, single-user Windows installation with classic
Outlook signed in to the university mailbox. New Outlook, macOS, Linux, Docker
and unattended Windows services cannot use this COM connection.

1. Run `setup.bat` to install the Windows-only pywin32 dependency and local Laya.
2. In `.env`, set `OUTLOOK_PROVIDER=desktop`, `OUTLOOK_SYNC_ENABLED=true` and
   `OUTLOOK_APP_ORIGIN=http://localhost:5173`. No Microsoft client ID, secret or
   token encryption key is needed for this provider.
3. Open classic Outlook. Check that its **default mailbox** is the university
   account; Farq reads only that store, including its mail subfolders. It does not
   enumerate other accounts or shared stores.
4. Start `scripts/dev.ps1` and open `http://localhost:5173`. Copy the local pairing
   code printed in the terminal. Alternatively print it with
   `.venv\Scripts\python.exe -m services.api.app.outlook.desktop` from the repo root.
5. Select **Emails → Connect Outlook**, enter that code, review the
   mailbox access description, and select **Allow and connect**.

Keep the API/Vite bound to loopback and run them as the signed-in Windows user.
The random pairing code is stored in ignored `.local-outlook-key`; protect it like
a local credential. Farq never prints email bodies to the console. Outlook may
show its own programmatic-access prompt; organization policy can block access.
Farq does not disable these protections. COM itself is broadly capable; read-only
behavior is enforced by this adapter, not by Microsoft delegated permission scopes.

The desktop adapter snapshots only EntryIDs through `Folder.GetTable()`, newest
first within each folder. It processes 20 IDs per batch, persists the remaining
IDs, and compares LastModificationTime before reading the body or running Laya.
It rescans folder metadata every 15 minutes and reconciles removed messages after
a complete folder scan. Missing individual messages are skipped as tombstones;
other Outlook errors keep the cursor for retry. Limits are 2,000 mail folders and
100,000 mail IDs per folder; exceeding a limit reports a sync error, not partial
success. Changes arriving during a snapshot appear in the next cycle. No live
Microsoft Graph delta service is used in desktop mode. This is not an archive:
complete cleaned, redacted text is retained using the 30-day cache policy below.

Desktop connections also use private HttpOnly sessions; demo headers cannot read
the mailbox. Disconnect removes cached mail and the Farq session, but does not
sign the Windows user out of Outlook. Live classic-Outlook testing is still needed
on a configured installation; automated tests use fake COM objects.

## Microsoft Graph alternative: register the Microsoft application

Set `OUTLOOK_PROVIDER=graph` to use the following web-based flow instead.

1. In Microsoft Entra, register a **Web** application for your university tenant
   (single tenant). Record the application/client ID and directory/tenant ID.
2. Add delegated Microsoft Graph **User.Read** and **Mail.Read** permissions.
   MSAL also requests its standard OpenID/refresh scopes. University policy may
   require an administrator to approve consent; the app does not bypass that policy.
3. Add the exact Web redirect URI `http://localhost:5173/api/outlook/callback` for
   local development. Use the same hostname consistently; 127.0.0.1 and localhost
   have separate cookies. For deployment, use your HTTPS frontend origin and callback.
4. Create a client credential, store it only in the API's environment, and set these
   values in local `.env` (never in a VITE_* variable or source control):

```dotenv
MICROSOFT_CLIENT_ID=<application UUID>
MICROSOFT_TENANT_ID=<directory UUID>
MICROSOFT_CLIENT_SECRET=<server credential>
OUTLOOK_APP_ORIGIN=http://localhost:5173
MICROSOFT_REDIRECT_URI=http://localhost:5173/api/outlook/callback
FARQ_TOKEN_ENCRYPTION_KEY=<Fernet key>
OUTLOOK_SYNC_ENABLED=true
```

Generate the encryption key locally after running `setup.bat` / `bash setup.sh`:

```sh
uv run --no-sync python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep that key outside the database and backed up securely. Replacing it invalidates
saved token caches and requires reconnecting. Do not paste credentials into chat.
The callback must pass through the same Vite/nginx frontend origin as the application.
Cross-origin VITE_API_BASE_URL deployment is not supported for this integration.

## Run and connect

Run the local classifier setup first, then launch Farq with its existing native
runner. These runners read `.env`. When launching uvicorn directly, supply the
environment yourself, or use `--env-file .env`; uvicorn does not automatically load
the file. Keep Uvicorn access logging disabled (`--no-access-log`) or configure your
proxy/log sink to omit callback query strings, which contain authorization codes.

Open **Emails**, then **Connect Outlook**. Microsoft handles credentials
and consent. A blocked popup falls back to a full-page sign-in; use Return to Farq
after the callback. Cancellation, expired state and rejected consent require starting
sign-in again. Tokens never pass to JavaScript.

The Microsoft session owns the mailbox independently of Farq's existing demo
profile. Connecting does not claim or migrate an unauthenticated demo student.
The shared `current_user()` identity function recognizes the secure session and
rejects attempts to impersonate Microsoft users with a demo header. The mailbox session applies only to `/api/outlook/*`; team routes keep their existing
demo identity. Connecting mail therefore does not change the active team member. Full student-profile account
migration is a separate authentication task.

Sync starts automatically, scans primary-mailbox folders and their children, then
tracks changes every 15 minutes while the API runs. Only changed message text is
classified. Work persists in SQLite as folder cursors and an expiring worker lease.
The UI shows processed counts and refreshes every 15 seconds. Pause stops in-flight
writes; Sync now can run a manual cycle while automatic sync is paused. Restarted
workers recover after the ten-minute lease expires. Initial large mailboxes can take
time, especially on CPU; folder order is not a newest-first guarantee.

Docker uses the locked CPU dependencies and downloads the pinned Laya snapshot at
startup only when Outlook is enabled and a client ID is configured. Its model cache
is in the API data volume. First startup can exceed the normal health-check window
while downloading: rerun compose after the cache is populated if needed.

## What the views mean

The inbox uses a compact message list and a full-text reading pane (a separate
reader with Back to inbox on smaller screens). Search covers sender, subject and
the complete cached text across pages. Filter by Laya category or sort by newest,
oldest or follow-up date. List previews are short; opening a message fetches its
complete cleaned text without truncation.

Select messages on the current page to review, pin, dismiss or restore them
together. Follow-ups collects messages with dates you set; Today includes those
that are due or overdue. Today/Tomorrow shortcuts do not schedule notifications.
Copy and Save text export the selected message's complete cleaned text locally.
Bulk actions are atomic and account-scoped, and never write to Outlook.

- Important includes pinned messages and Laya importance suggestions (0.6 threshold).
  The threshold is a UI heuristic, not calibrated probability or a deletion rule.
- Today shows mail received on the selected day in the browser's timezone,
  plus student-entered dates due that day or overdue. Dates are entered by the
  student; the classifier does not extract or invent deadlines.
- Needs review retains uncertain, unsupported-language and unreviewed results.
  Laya typed-decisions is English-only; Arabic remains visible with a review label.
- Pin, dismiss, review and date changes affect only the local Farq cache. Reviewed
  does not mean confirmed profile evidence and creates no StudentFact.

Raw message bodies exist only during normalization/classification. The database
retains redacted subjects, sender display names, complete cleaned and redacted text,
classification results and source links for 30 days after classification. Pinning
does not extend retention. Identity-number/email redaction is best-effort, not a
guarantee that prose contains no personal information. Protect the local database.

Disconnect stops jobs, deletes cached mail, dates, folders, sessions and encrypted
tokens. It does not delete anything in Outlook or revoke Microsoft-side consent;
that can be removed separately in the Microsoft account's application permissions.
Sync and Laya classification send no mailbox data to cloud models. The optional
selected-email Q&A described below requires explicit consent and uses a separate
Hermes gateway. Email never becomes a StudentFact or team event.

## Verification

Automated tests mock Microsoft and exercise browser-bound one-time OAuth state,
private account ownership, CSRF protection, token encryption, pagination, dedup,
deletion and disconnect races. A real university account is still required to verify
tenant consent, live token refresh and a complete mailbox round trip. No developer
credential is bundled with this repository.

See [threat model](outlook-threat-model.md) and [classifier details](local-email-classifier.md).

## Integrated personal Outlook / public-client sign-in

Main's personal-mail connection now feeds the same private cache, cleaner, Laya
classifier and Emails workspace as desktop Outlook. Choose **Emails → Other
Outlook connection options**. For this option, set `FARQ_TOKEN_ENCRYPTION_KEY`
(a Fernet key, generated with `.venv/Scripts/python -c "from cryptography.fernet
import Fernet; print(Fernet.generate_key().decode())"` on one line).

- Device code: set `OUTLOOK_CLIENT_ID` to a public-client app ID and
  `OUTLOOK_TENANT=consumers` for personal Outlook, or an approved university tenant
  ID. Enable public-client flows in that app. Consent requires **User.Read** and
  **Mail.Read**. No client secret or redirect URI is needed for this option.
- Temporary token: paste an already-approved Graph access token with those scopes.
  It is encrypted on the API server, cannot refresh, and requires reconnecting
  after expiry. It cannot bypass an organization's consent restrictions.
- On macOS/Linux, use `OUTLOOK_PROVIDER=graph`; personal options do not require the
  confidential-client `MICROSOFT_*` settings. Desktop COM remains Windows-only.

Old main-branch `/api/students/{id}/outlook/*` endpoints were removed because a demo
student ID is not mailbox authentication. Existing prototype connections must be
reconnected. Legacy `outlook_accounts` rows are not imported or exposed; a previous
prototype database/backup may still contain its old plaintext tokens. New tokens
are stored only in encrypted `outlook_connections.token_cache`.

## Selected-email Q&A and Home

Home shows today's mail in its right-hand column beneath Up next; on narrow screens
it stacks vertically. The Emails sidebar entry opens the full shared inbox.
Select emails (or open one), expand **Ask about…**, enter a question, accept sending
that selection to the configured AI providers (including fallback providers), and
ask. The API checks ownership, expiry and consent. It rejects selections over 25
messages or 24,000 context characters instead of silently truncating them. This
limit does not affect the full email reader or local classification.

Q&A runs on a separate Hermes process/home with no enabled tools, Farq plugin,
skills or long-term memory. Windows `scripts/dev.ps1`, `scripts/run_windows.py`,
macOS `scripts/firas_run_mac.py`, and Docker Compose start it automatically. Native
port: **8643**; API override: `HERMES_EMAIL_URL`. Never point that variable at the
Coach gateway or mount Coach state into the email runtime. The checked-in config
is `services/hermes/email-config.yaml`. Restart the runner after updating.
The email runtime (`.hermes-email-runtime` / Docker `hermes-email-data`) and model
providers may retain request transcripts; disconnect deletes Farq's mail cache,
not already submitted requests. No answer is automatically saved as facts or plans.
