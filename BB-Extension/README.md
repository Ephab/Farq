# IAU Blackboard Read-Only Extractor

Target: `https://vle.iau.edu.sa/` — Imam Abdulrahman Bin Faisal University, Blackboard Learn **Ultra**
(Student login: `/auth-saml/saml/login?apId=_179_1&redirectUrl=.../ultra`, Faculty: `_178_1`).

This project investigates extraction without administrator approval, REST API registration,
or password storage, then implements the simplest reliable method.

Read-only guarantee: the extractor issues **GET requests only**. It never submits assignments,
modifies grades, marks content complete, sends messages, or changes anything.

---

## 1. Investigation: what IAU actually exposes

### Deployment observed (no login required to verify)

- Landing page (`GET https://vle.iau.edu.sa/`) shows "E-Learning Management System" with
  separate Faculty Login and Student Login buttons, both SAML (`/auth-saml/saml/login`)
  redirecting to `/ultra`. This is Blackboard Learn with Ultra base navigation.
- Password reset points to `passwordreset.microsoftonline.com` (Microsoft/Entra SSO in front).
- Public docs portal: `https://iauelearning.iau.edu.sa/blackboard-ultra`.

### Method 1 — Calendar / iCalendar (ICS feed)

**How it works (supported):** Ultra base navigation → Calendar → Settings gear →
menu next to "Calendar Settings" → **Share Calendar** → copy link (ends in `.ics`).
Paste into Google/Apple/Outlook subscription, or into this extractor's popup.

**Auth:** No admin approval. The link itself contains an unguessable token. Anyone with
the URL can read it, so treat it like a password and share only with trusted apps.
The feed is generated per-user after login; you copy it once while logged in.

**What it exposes:**

- Assignment/test due dates (GradebookColumn items), class sessions, instructor-created
  course events, office hours.
- Window: **~1 year past → ~1 year future** (Blackboard-documented).
- All courses combined; **cannot share a single course** (Blackboard limitation).
- Typical VEVENT fields: `SUMMARY`, `DTSTART/DTEND/DUE`, `UID`, `DESCRIPTION` (often short),
  `URL`, `LOCATION`.

**What it does NOT expose:**

- Full assignment descriptions, submission status, grades/feedback, announcements,
  course materials/files, instructor roster, content bodies, attempt history.
- Course IDs are usually human-readable names in SUMMARY, not internal `_xxx_1` IDs.
- No per-course filtering; course split is heuristic (`"Course: Title"`).

**Windows/macOS:** Yes — plain HTTPS GET of a `.ics` URL; this repo's `src/ics.js` parses
it with no dependencies on both OSes.

**Reliability:** High. This is a documented, supported Blackboard feature. Format is RFC 5545.
Limitation: sync delay (clients poll; Blackboard docs note up to ~24h in external calendars),
and instructors must actually set due dates for items to appear.

**Verdict:** Use as a **supplement for deadlines/events**, not the primary extractor.

### Method 2 — Blackboard email / push / stream notifications

**How it works (supported):** Profile → Global Notification Settings → Stream / Email /
Push. Options include: new gradable items, new content, new/upcoming/past-due dates,
new courses, discussion/message activity, grades. Frequency: "right away" or "once a day".

**Auth:** No admin approval. Student opts in with their own profile email.

**What can be extracted (if enabled):**

- Subject/body snippets for announcements, due-date reminders, grade-posted notices.
- Fields vary by template; reliably present: course name, item title, action link back
  to Blackboard. Unreliably present: full description, exact due timestamp, score.

**Limitations (why not primary):**

- Opt-in and lossy: only what Blackboard chooses to notify on, only after you enable it.
- Delayed, batched (daily digest), no history backfill, no materials/rosters.
- Parsing HTML email is fragile across locales (IAU offers Arabic + English).
- Organization activities do not trigger email notifications.

**Windows/macOS:** Yes (any email client), but not machine-readable enough for the
requested JSON schema.

**Verdict:** Useful as an alerting channel. Not sufficient for courses/assignments/
grades/materials extraction. This extractor does not depend on it.

### Method 3 — Authenticated browser access (implemented)

**How it works:** You log in normally in Chrome/Edge/Firefox (including SSO/MFA).
A content script / console snippet running on `https://vle.iau.edu.sa/*` calls the
same Blackboard endpoints the Ultra UI itself calls, with `fetch(..., { credentials:
"include" })`. No OAuth token, no App ID, no stored password — the browser's existing
session cookies (`BbRouter`, `JSESSIONID`, HttpOnly) are sent automatically.

Representative read endpoints probed (all GET):

| Purpose | Endpoint |
|---|---|
| Identity | `GET /learn/api/v1/users/me` |
| My courses | `GET /learn/api/v1/users/me/memberships?expand=course` |
| Roster/instructors | `GET /learn/api/v1/courses/{id}/users?expand=user` |
| Content/materials | `GET /learn/api/v1/courses/{id}/contents` + `/contents/{cid}/children` |
| Announcements | `GET /learn/api/v1/courses/{id}/announcements` |
| Grade columns (assignments) | `GET /learn/api/public/v2/courses/{id}/gradebook/columns` |
| My grades (documented student paths) | `GET /learn/api/public/v1/courses/{id}/gradebook/users/{uid}` primary; fallback per-column `GET .../columns/{col}/users/{uid}` |
| Attempts (submission status) | `GET /learn/api/public/v2/courses/{id}/gradebook/columns/{col}/users/{uid}/attempts` |
| Calendar/deadlines | `GET /learn/api/public/v1/calendars/items?courseId={id}&since=&until=` + global sweep |

**Auth:** No admin approval. Requires the student to be logged in (SAML/Microsoft SSO
+ any MFA) in the same browser profile. Session expiry (~hours) just means re-login;
no credential is ever read (`HttpOnly` cookies are invisible to `document.cookie`).

**Data available:** All requested fields — current courses, names + internal IDs
(`_xxx_1`) + human codes, assignments with descriptions + due dates + submission
status, announcements with full bodies, grades + feedback, upcoming events, instructor
names/emails, materials/content tree, and original Ultra URLs with IDs preserved.

**Windows/macOS:** Yes. Manifest V3 extension runs on Chrome/Edge/Brave (both OSes);
console snippet runs anywhere. No native code.

**Reliability and limitations:**

- Depends on **undocumented internal Ultra API** (`/learn/api/v1/...`). It is stable in
  practice (used by the Ultra UI and by community tools like `blackboard-mcp`,
  `LintLearn`, `blackboard-course-fetcher`, `bbsync`), but Blackboard may change it
  without notice. Mitigation: every endpoint is probed independently; one 404/403
  degrades that section only and is recorded in `diagnostics.endpointStatus`.
- Pagination handled (`limit/offset` until `paging.nextPage` is null, capped).
- Dynamically loaded/virtualized lists are avoided by using the JSON API rather than
  scrolling the DOM. No fragile CSS selectors in the primary path.
- Student role can only read own grades; hidden columns return 403 (normal, skipped).
- Classic/Original courses expose less via Ultra endpoints; `bb_raw_request`-style
  fallback is the documented escape hatch (not bundled to keep this read-only and small).

**Verdict:** **Primary method.** Most data, no admin, read-only, cross-platform.

### Method 4 — Official Blackboard REST API + OAuth (2LO / 3LO)

**How it works (documented):** Developer registers an app at `developer.blackboard.com`
(gets Application ID + key/secret), then a Learn **administrator** creates a REST
integration in Admin Panel → REST API Integrations, assigns a Learn user/role with the
required entitlements/privileges, and optionally enables 3-legged OAuth (user consent).

**Auth:** **Requires administrator approval.** Anthology docs are explicit:

> "By default, no Applications can access the REST APIs. A Blackboard Learn
> Administrator must enable each app ... Before you can use an integration ...
> an administrator must register it."

Even 3LO (which adds per-user consent) still requires the admin to register the
Application ID first. There is no student self-service registration on IAU's tenant.

**Data available:** Broad (courses, contents, gradebook, calendars, announcements —
subject to granted entitlements), but irrelevant without admin action.

**Windows/macOS:** Yes, but blocked by process, not platform.

**Verdict:** Not usable under the task constraints. Clearly identified as
**admin-gated**; do not assume it works. This extractor does not use OAuth at all.

### Summary table

| Method | Admin needed? | Password stored? | Data coverage | Win/Mac | Stable/supported? | Depends on undocumented behavior? |
|---|---|---|---|---|---|---|
| ICS calendar feed | No | No (token URL only) | Deadlines/events only | Yes | Yes (supported) | No |
| Email/push notifications | No | No | Snippets/alerts only | Yes | Yes, but lossy | No |
| **Authenticated browser (fetch with session)** | **No** | **No** | **Full (implemented)** | **Yes** | Partially (UI surface, but unofficial) | **Yes (`/learn/api/v1/...`)** |
| Official REST/OAuth | **Yes** | Key/secret server-side | Full (if granted) | Yes | Yes | No |

---

## 2. What was implemented

Simplest reliable combination that maximizes data without admin approval:

1. **Primary: in-browser authenticated fetch** (`src/extractor.js`) — same-origin GETs
   listed above, merging gradebook columns + content + calendar + grades + roster.
2. **Supplement: ICS merge** (`src/ics.js` + popup field) — optional user-pasted calendar
   URL fills gaps in deadlines; events deduped against API calendar items.

Delivered as both:

- **Browser extension (MV3)** — `manifest.json`, `src/content.js`, `src/popup.html/.js`.
  Load `about:extensions` → Developer mode → Load unpacked → select this folder.
  Then open `https://vle.iau.edu.sa/ultra`, log in, click the extension → Extract →
  Download JSON.
- **Console snippet** — `tools/extract-console.js`. Paste into DevTools Console on a
  logged-in Blackboard tab for users who prefer not to install anything.

Both produce the same structured JSON (v2 adds `assessments`/`content` names,
`assignments`/`materials` kept as aliases):

```json
{
  "courses": [],
  "assessments": [],
  "announcements": [],
  "grades": [],
  "events": [],
  "content": [],
  "diagnostics": {},
  "summary": {}
}
```

Assignment shape (as requested):

```json
{
  "course": "Intro to Computing",
  "course_id": "_101_1",
  "title": "Assignment 1",
  "description": "Do it...",
  "due_date": "2026-02-10T20:59:00.000Z",
  "submission_status": "Graded",
  "grade": "9/10",
  "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline?contentId=_c1",
  "source_id": "_col1"
}
```

Dedupe: ID-stable only — records merge on shared Blackboard IDs
(`column_id`/`content_id`/`calendar_id`, linked via `contentId` and calendar
`dynamicCalendarItemProps.id`), never on title similarity. Timestamps are
Blackboard UTC (`Z`); convert to Asia/Riyadh for display, never treat as local.

---

## 2b. v2 improvements (built on the working pipeline, no redesign)

- Announcements: rich-text objects (`rawText`/`displayText`) extracted properly;
  the old `stripHtml(object)` → `"[object Object]"` bug is fixed and covered by tests.
- Grades: the 404 path `.../users/{uid}/grades` (missing `/gradebook/`) is removed
  and listed in `KNOWN_BAD_GRADE_PATHS`; grades use documented
  `.../gradebook/users/{uid}` + bounded per-column fallback, with score/possible,
  computed percentage, feedback, posted date, and attempts.
- Assessments carry `content_id`/`column_id`/`calendar_id`/`attempt_id`, availability
  windows, submitted timestamps, and a type (Assignment/Quiz/Exam/Attendance/Manual/Other).
- Content records carry parent ID, breadcrumb path, availability, created/modified,
  attachment metadata (no auto-download), and external/LTI links.
- Scope: popup radio or `window.BB_EXTRACT_OPTIONS = { scope: "current" }`
  (default) vs `"all"`. Current detection combines availability, course/term date
  windows, and enrollment recency — never name formatting alone.
- Diagnostics: per-source `{ source, endpoint, status, count, elapsed_ms, error }`
  with credential-stripped errors, plus a `summary` block and `failed_sources`
  list rendered by the popup. See `docs/CURRENT-EXTRACTION.md`.
- Privacy: `--redact` (popup checkbox or console option) pseudonymizes user IDs,
  usernames, emails, and membership IDs while preserving course/content/assessment IDs.
  Export JSON patterns are in `.gitignore`.
- Reliability: timeouts + retries with exponential backoff (transient 429/5xx only),
  3-course concurrency cap, per-course isolation, partial exports, safe HTML parsing,
  ISO-8601 timestamp normalization. Full suite: `node test/run-tests.js`.

## 2c. v3 improvements

Waypoint runs this same `src/` extractor headlessly for its Blackboard sync (`services/api/app/blackboard_sync/`).

- Calendar windows: the date range is split into windows of at most 16 weeks
  (`U.calendarWindows`); the old single 210-day window returned HTTP 400.
- Due-date fallbacks (grading/column due, content dates, calendar items) plus
  `is_upcoming` / `is_overdue` flags per assessment (submitted/graded work is never
  overdue; attendance is not a deadline) and `summary.upcoming_deadlines` / `summary.overdue`.
- Instructor probes (`ultra-course`, `public-memberships`) replace the 404 roster
  endpoint; `course.instructor_source` records which one answered.
- 403 and probe misses (`probe_*`, `forbidden` statuses) are no longer counted in `failed_sources`.
- Public contents API (`/learn/api/public/v1/courses/{id}/contents`, Ultra list as fallback)
  with folder walking and attachment `download_url` (metadata only; the extension never
  downloads). An `attachments:<courseId>` diagnostics source reports `ok`/`partial`,
  `truncated`, and `listing_errors`.
- Plain-text `body_text` with `body_html` kept.
- Category titles resolved for gradebook categories (columns only carry category IDs).
- `term_name`, `grade_summary` (earned/possible/percentage/graded/pending/missing) and
  `final_grade` per course (`null` unless the course total column is readable).
- The console snippet `tools/extract-console.js` is generated from `src/`
  (`node tools/build-console.js`; `--check` fails if stale; the test suite runs it).
- `captureSamples`: `extractAll({ captureSamples: true })` adds `diagnostics.samples`,
  the first raw record per source family with user keys removed and strings cut to 120
  characters, for debugging endpoint shapes. Never set by the backend.

---

---

## 3. Usage

### Option A — extension (recommended)

1. Log into https://vle.iau.edu.sa/ultra as a student (complete SSO/MFA yourself).
2. `chrome://extensions` → Developer mode → Load unpacked → this folder.
   (After this update: reload the extension on `chrome://extensions` so the new
   `bb-utils.js`/`bb-model.js` content scripts take effect.)
3. (Optional) Blackboard Calendar → Settings → Share Calendar → copy `.ics` URL.
4. Click the extension → choose Current (default, `--current`) or All (`--all`),
   tick Redact for `--redact`, paste ICS URL (optional) → **Extract to JSON** →
   Download JSON. The popup prints a `Courses: X current / Y total …` summary
   plus failed sources.

### Option B — console (no install)

1. Same login.
2. (Optional) set scope/redact first:
   `window.BB_EXTRACT_OPTIONS = { scope: "current", redact: false, captureSamples: false }`
3. F12 → Console → paste `tools/extract-console.js` (generated from `src/`) → Enter.
4. JSON downloads automatically; a text summary is logged.

### Comparing with the previous export

I cannot run the extractor against your live session from here (no access to
your browser profile). To compare: run the old export and the new export back
to back with scope `all`, then diff counts and spot-check one course's
announcements (object bodies), one assessment's `content_id`/`column_id` pair,
and the `summary`/`failed_sources` blocks. Expected deltas: zero
`"[object Object]"` bodies, assessments with IDs + types, grades via the
documented path, current-only default, and per-source diagnostics.

### Tests

```powershell
node test/run-tests.js
node test/mock-extract.js
```

Covers ICS parsing/unfolding, UTC handling, dedupe, assignment shape, manifest scope,
and a mocked end-to-end `extractAll()` proving course/instructor/assignment/grade/
announcement/event/material merging and URL preservation.

---

## 4. Files

- `manifest.json` — MV3, scoped to `https://vle.iau.edu.sa/*` only.
- `src/bb-utils.js` — safe rich-text/HTML, timestamp normalization, GET with
  retries/backoff, pagination, concurrency cap, error sanitizing.
- `src/bb-model.js` — assessment classification, current-course scoring,
  ID-stable merge, redaction (pure functions, fully unit-tested).
- `src/extractor.js` — core read-only extractor (browser + Node).
- `src/ics.js` — dependency-free ICS parser.
- `src/content.js` — content-script bridge (message API only).
- `src/popup.html`, `src/popup.js` — popup UI (scope/redact/ICS/summary/download).
- `tools/extract-console.js` — standalone DevTools snippet (same pipeline).
- `docs/CURRENT-EXTRACTION.md` — per-category source documentation.
- `test/sample.ics`, `test/run-tests.js`, `test/unit-tests.js`,
  `test/mock-extract.js` — verification (no live account needed).

## 5. Safety notes

- GET only. Search the code for `fetch(` — every call uses `method: "GET"`.
- No login form handling, no MFA/CAPTCHA interaction, no authorization bypass.
- Honors course availability and student entitlements (403 = skipped, logged).
- ICS URL is a bearer token: do not commit exports containing it; do not share it.
- Do not use this to access data that is not yours; IAU acceptable-use policy applies.
