# Blackboard sync — design

Date: 2026-10-03 · Status: draft for review

## Goal

In **My Data**, the student clicks **Sync my Blackboard data**. The only thing they
ever type is their IAU username and password. Waypoint signs in, extracts their
Blackboard Ultra data in the background, keeps it fresh, and feeds it to Hermes,
Today and the evidence review. The BB-Extension extractor is improved to return more,
and more useful, data, and the app runs that same extractor.

### Decisions already made

| Question | Decision |
|---|---|
| Login extra verification | None: IAU sign-in is username + password (AD FS) |
| Extra data | All of: deadlines, instructors, readable text + file text, academic picture |
| What My Data shows | Summary card; bulk data goes to Blackboard tables; only profile-worthy items become `suggested` evidence |
| Re-sync | Remember the password (encrypted) for hands-off periodic sync |
| Login engine | Python Playwright (headless Chromium) in the API, injecting the extension's extractor |

## Login flow (observed 2026-10-03)

1. `GET https://vle.iau.edu.sa/?new_loc=%2Fultra%2Fstream` (landing, "Student Login").
2. Student Login → `/auth-saml/saml/login?apId=_179_1&redirectUrl=…/ultra` →
   redirect to **AD FS** `https://iauauth.iau.edu.sa/adfs/ls/?SAMLRequest=…`.
   The SAMLRequest/Signature are single-use; Waypoint never stores or replays them.
3. AD FS form: `#userNameInput`, `#passwordInput`, `#submitButton`; errors in `#errorText`.
4. SAML POST back → `https://vle.iau.edu.sa/ultra/course` (logged in).

Waypoint navigates to the Student Login URL, fills the form, and waits for an
`https://vle.iau.edu.sa/ultra` URL. It then confirms the login with
`GET /learn/api/v1/users/me`. Anything else is classified as one of the failures below.
Selectors live in one constant block so a portal change is a one-line fix.

## Architecture

```
My Data card ── POST /api/students/{id}/blackboard/sync  {username?, password?, remember}
     │          GET  /api/students/{id}/blackboard/sync   (status + summary, polled)
     │          DELETE /api/students/{id}/blackboard/connection  (forget login + session)
     ▼
services/api/app/blackboard_sync/
  credentials.py  Fernet encrypt/decrypt (reuses outlook.auth key), store, forget
  browser.py      BlackboardBrowser protocol + PlaywrightBrowser: login, classify
                  failures, save/restore storage_state, inject extractor bundle,
                  fetch attachments in-memory (same session, GET only)
  files.py        attachment bytes → redacted text (pypdf / python-pptx / python-docx),
                  caps: 15 MB per file, 60 files per sync, 40k chars per file
  ingest.py       export JSON → BlackboardCourse / BlackboardContentItem /
                  BlackboardGrade upsert + suggested EvidenceItems
  worker.py       one job per student; stage machine; 6 h periodic loop
```

The extractor bundle is `BB-Extension/src/bb-utils.js`, `bb-model.js` and
`extractor.js`, read from the repo at startup and injected with `page.add_script_tag`.
The sync then runs `await BBExtractor.extractAll({scope: "all"})` with `page.evaluate`.
One codebase serves the extension popup, the console snippet and the app.

## Extension improvements (`BB-Extension/src/`)

Priority A → D. All calls stay GET-only and same-origin.

**A. Deadlines**
- Fill `due_date` from the calendar API: use `/learn/api/public/v1/calendars/items`
  over the term window with an explicit `since`/`until` (≤ 16-week windows, as Blackboard requires).
- Also fill it from the gradebook column `grading.due` and content `contentDetail` / assessment due fields.
- Emit `events` from calendar items that are not assessments.
- Add `is_overdue` / `is_upcoming` (relative to `exported_at`).

**B. Instructors**
- Rosters 404 for students. Instead use the course detail `instructorsMembership`, or
  `/learn/api/v1/courses/{id}?expand=instructorsMembership`, with the `/learn/api/public/v1/courses/{id}/users?role=Instructor`
  probe as a fallback.
- Keep name + email. Record which path worked in diagnostics.
- Stop calling the known-404 roster path, so the old 189 failed sources mostly disappear.

**C. Readable text**
- `body_text` becomes plain text; HTML is kept separately in `body_html`. The current export puts HTML into `body_text`.
- Embed-URL descriptions are resolved to the attachment they point to.
- Attachments get a GET-able `download_url`. The Python side reads the file text (see `files.py`).
  The bytes are never written to disk or the DB, only redacted extracted text.

**D. Academic picture**
- Per course: `grade_summary` = earned / possible-so-far, running %, count graded / pending / missing.
- `term_name` comes from `/learn/api/v1/terms`.
- `final_grade` for completed courses, when the gradebook exposes an external/total column.

Each improvement also gets unit tests and a mock-extract fixture.

## Data model

New:
- `BlackboardConnection` (one row per student):
  - `username`, `password_enc` (nullable), `session_enc` (nullable).
  - `status` (`idle|queued|logging_in|extracting|reading_files|saving|done|failed`).
  - `stage_detail`, `failure_reason`, `failed_logins`, `last_synced_at`, `next_sync_at`, `summary_json`.
- `BlackboardGrade`: `course_id`, `external_id` (column id), `title`, `score`, `possible`,
  `percentage`, `status`, `feedback`, `posted_at`.

Extended (additive columns):
- `BlackboardCourse`: `is_current`, `instructors_json`, `grade_summary_json`, `url`.
- `BlackboardContentItem`: `url`.

Mapping:
- Each course → `BlackboardCourse(source_kind="blackboard_live")`.
- Announcements → `announcement`.
- Assessments → `assignment` (with `due_at`).
- Content → `lecture` / `document`, or `syllabus` when the title matches syllabus/outline/خطة المقرر.
- File text goes into its content item's `body_text`.
- Grades → `BlackboardGrade`.

The first live sync removes that student's `blackboard_demo` rows. Upserts are keyed on
external IDs, and items gone from Blackboard are deleted for `blackboard_live` courses.
The existing Hermes tools work unchanged. `list_courses` / `read_item` additionally
expose deadlines and grade summaries.

Evidence: one `DataSource(kind="blackboard")`. `EvidenceItem`s in `suggested` state are created for:
- completed courses with a final grade, as a course + grade;
- current courses, as an enrolled course.

The fingerprint is `blackboard:{course external_id}:{kind}`, so re-syncs never duplicate
or resurrect dismissed items. Announcements, content and grades never become evidence.
Nothing becomes a `StudentFact` without review.

## API

- `POST /api/students/{id}/blackboard/sync`
  - With body `{username, password, remember: bool}`: first sync or re-auth.
  - Without a body: re-sync using the stored session or credentials.
  - Returns `202` + status. If a job is already running, it returns that job.
- `GET /api/students/{id}/blackboard/sync`
  - Returns `{status, stage_detail, failure_reason, last_synced_at, next_sync_at, summary, has_saved_login}`.
  - Never returns credentials.
- `DELETE /api/students/{id}/blackboard/connection`
  - Wipes the password, the session and the connection row.
  - Keeps the synced course data, which is removable via the existing data removal.

All three check ownership via `OwnedStudent`. The Blackboard switch in `disabled_connectors`
pauses the periodic loop, and it also makes `POST` return 409.

## Security (B: remembered password)

- `password_enc` and `session_enc` use the Fernet key `WAYPOINT_TOKEN_ENCRYPTION_KEY`.
  If the key is missing, sync still works but `remember` is refused.
- Credentials never reach:
  - the browser, after submit,
  - logs (the sanitizer strips form values and cookies),
  - Hermes,
  - exports, or `summary_json`.
- `remember=false` uses the password for this one login only, then drops it. The session is still kept.
- 3 consecutive bad-password results wipe `password_enc` and stop the loop, so Waypoint
  never locks the student's IAU account. Network errors do not count.
- Requests to IAU are GET-only, except for the AD FS login form submit.
- File text goes through the same redaction as other imports.
- `docs/blackboard-threat-model.md`, a short document like the Outlook one, covers:
  - the stored-password blast radius (the IAU account unlocks mail/Teams);
  - the local-machine trust assumption;
  - the forget path;
  - why an extension-only design was rejected (UX).
- AGENTS.md gets one invariant line pointing to it.

## Failure handling

| Case | Detection | Card text / action |
|---|---|---|
| Wrong password | `#errorText` visible | "Username or password is incorrect"; ask again; `failed_logins += 1` |
| Unexpected page (MFA, password change, consent) | not on `/ultra` within 30 s and no `#errorText` | "IAU asked for something extra; sign in once at vle.iau.edu.sa, then retry" |
| IAU/network down | timeout, DNS, 5xx | "Blackboard is unreachable; will retry at next sync"; data kept |
| Session expired | `/users/me` → 401 or redirect to login | silent re-login with stored password; else ask |
| Partial extraction | `summary.failed_sources` > 0 | Success: "Synced (some sections unavailable)" |
| Playwright/Chromium missing | launch error | "Run setup again to install the Blackboard sync browser" |

Single-flight: one job per student, using an in-process lock plus the status row.
Hard timeout is 10 min per sync. A `queued`/running status left over from a crash is reset on startup.

## UI (My Data)

- A new "Blackboard" card at the top of the sources step, with the same styling as the other sources:
  - **Not connected:** username + password fields, a "Remember my login so Waypoint
    keeps syncing" checkbox (on by default, with a one-line explanation), and **Sync my Blackboard data**.
  - **Running:** stage text (Signing in… / Reading courses… / Reading files… / Saving…).
  - **Done:** "16 current courses · 37 upcoming deadlines · 3 new items to review · synced 2 min ago",
    plus **Sync now**, **Review new items** (opens the existing review) and **Forget my login**.
  - **Failed:** reason + one action.
- The card polls every 2 s while running. Copy is added in en + ar locales.
- The Settings connector description drops "(demo snapshot)".

## Setup

- `pyproject.toml` / `uv.lock`: add `playwright`.
- `setup.bat` / `setup.sh` run `python -m playwright install chromium`.
- The Dockerfile installs Chromium with `playwright install --with-deps chromium`.

## Testing

- **Extension:** `node test/run-tests.js` + `mock-extract.js` with new fixtures for A–D:
  - calendar due fill;
  - instructor fallback;
  - plain-text `body_text`;
  - grade summary;
  - no roster-404 calls.
- **Backend:** `services/api/tests/test_blackboard_sync.py` with a `FakeBrowser`:
  - ingest from a recorded, redacted export slice;
  - demo rows replaced;
  - evidence dedupe and dismissed items not resurrected;
  - credentials absent from every response and log line;
  - forget wipes everything;
  - 3 bad passwords → wiped;
  - single-flight;
  - connector switch → 409;
  - the `files.py` caps.
- **Manual live smoke (the student):** sync once from My Data; compare counts against
  the 2026-10-03 export; confirm due dates and instructors are present.

## Out of scope

- Writing anything to Blackboard.
- Other universities and Blackboard tenants.
- MFA support. It's not needed today; it would be a follow-up if IAU adds it.
- Storing attachment files.
- Turning grades into `StudentFact`s automatically.
