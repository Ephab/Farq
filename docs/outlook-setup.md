# Outlook mail

Farq supports exactly two mailbox connections. Both use the same private cache,
email cleaner, local Laya classifier and Emails workspace.

| Method | Platform | What you do |
| --- | --- | --- |
| Classic Outlook | Native Windows with classic Outlook installed | Open Outlook, then check the consent box in Emails |
| Temporary Microsoft Graph token | Windows, macOS, or Docker | Paste a Microsoft-issued token and accept mailbox access |

No Entra app registration, OAuth popup or device-code flow is implemented in Farq.
The temporary-token method still requires Microsoft consent and is subject to
organization policy; Farq cannot bypass restrictions or mint a Microsoft token.

## Setup and start

From the repository root, run `setup.bat` and then `run.bat` on Windows. On macOS,
run `bash setup.sh` and then `bash run.sh`. Open **http://localhost:5173**.
Setup installs locked dependencies, checks/installs Hermes, downloads and smoke-tests
Laya, installs frontend packages, and generates missing local credentials in `.env`.
Existing provider keys and valid generated secrets are preserved.

`HERMES_API_KEY` authenticates Farq to its gateways; `FARQ_INTERNAL_TOKEN`
authenticates the project plugin; `FARQ_TOKEN_ENCRYPTION_KEY` protects Graph tokens.
When the passive Windows registry probe finds classic Outlook, setup also generates
`OUTLOOK_LOCAL_TOKEN`. This local secret never goes into browser JavaScript and is
not a Microsoft access token. No mailbox is opened or read during setup. After
installing classic Outlook later, rerun setup or restart the native runner.

## Classic Outlook: checkbox only

Sign in to the desired account in classic Outlook and make it the default mailbox.
In **Emails**, check **I allow Farq to read and locally classify my classic Outlook
mailbox**. Farq automatically obtains a short-lived browser consent cookie and
connects; there is no pairing-code field, token copying, or app registration.
Outlook or your organization can still require its own access approval.

Only the default store and its mail subfolders are read. New Outlook, Outlook for
Mac, containers and unattended services cannot use Windows COM. Unsupported devices
show that this method is unavailable and can use a temporary Graph token instead.
Keep native servers on loopback; local connection writes verify Origin and Host.

## Temporary Graph token

Obtain a token through your organization's approved Microsoft tooling (for example,
[Microsoft Graph Explorer](https://developer.microsoft.com/graph/graph-explorer)).
It needs **User.Read** and **Mail.Read** consent. Expand the temporary-token option,
paste it, accept access and connect. The token remains encrypted on the server.
It is never stored in `.env`, returned to the browser, or sent to Hermes.

Tokens cannot refresh in Farq. On expiry or provider rejection the worker stops
and the Emails view offers the token form again. Reconnecting the same account
retains its cached messages and resumes sync. Setup cannot generate this credential.

## Sync, text, and privacy

Sync processes bounded pages in the background, deduplicates unchanged messages,
and checks for changes every 15 minutes while the API is running. Graph uses
per-folder delta cursors. Classic Outlook snapshots EntryIDs and reads up to 20
changed messages per page. Pause/resume and disconnect invalidate running work.
No messages are sent, marked read, moved or deleted in Outlook; attachments and
calendars are not imported. Mail links and remote images are never fetched.

The cleaner removes known external-sender banners and opaque tracking URLs before
Laya. The reader keeps the complete cleaned, best-effort-redacted text; long emails
are classified in overlapping windows. Cleaned text and suggestions expire after
30 days. Pinning does not extend retention. Protect the local SQLite database.
Laya's categories are uncalibrated suggestions; Arabic requires manual review.

Home's right column shows today's mail and follow-ups. Emails offers Important,
Today, Needs review, Follow-ups, All mail, Dismissed, search, full-text reading,
pinning, batch actions, follow-up dates, copy and text export.

Mailbox sessions are private and separate from demo student/team identities.
Disconnect deletes the Farq cache and stored connection credentials, but neither
changes Outlook messages nor revokes Microsoft-issued tokens externally.

## Optional email Q&A

Select messages, expand **Ask about…**, ask a question and explicitly accept sending
the selection to the configured AI providers, including fallbacks. The API checks
ownership and expiry and rejects more than 25 messages or 24,000 context characters
without truncating. This bound does not limit the reader or local classification.

Coach and email Q&A use the same Hermes gateway at port 8642, sharing tools and
memory. Email-derived history may outlive the 30-day cache and mailbox disconnect.
Answers never automatically create student facts or accepted roadmap changes.

To search from Coach chat, enable **Allow Coach to search and read my synced
emails** in Emails, then ask Coach about your mail in the same browser. It searches
the synced local cache and reads paginated bodies through read-only tools. Consent
is scoped to the browser mailbox session, not a demo student ID. Unchecking it
revokes future tool access immediately; reconnecting requires new consent.


## Upgrading

Old Entra/device-code connections are no longer served or synced; reconnect with
one of the two supported methods. The old endpoints and MSAL dependency are removed.
Setup removes obsolete Microsoft app-registration settings from `.env`. It does not
alter existing databases or backups: legacy tables/backups may still contain old
tokens. Old `.local-outlook-key` files are ignored and unused.
See [the threat model](outlook-threat-model.md) for boundaries and remaining limits.
