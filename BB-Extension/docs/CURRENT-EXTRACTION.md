# How the extractor currently obtains each data category

All calls are same-origin `GET` with the student's existing login cookies
(`fetch(..., { credentials: "include" })`). No OAuth, no App ID, no password,
no admin approval. One failed course never aborts the export (per-course
isolation, `U.limitedMap` with 3 concurrent courses).

## Identity
`GET /learn/api/v1/users/me` → `user { id, userName }`.
Failure here aborts with "log in first" (nothing else can work without it).

## Courses
`GET /learn/api/v1/users/me/memberships?expand=course` (paged, limit 100).
Each membership's embedded `course` gives id, code, name, availability,
term id, created/modified. Enrollment date + role come from the membership.
Fallback only if empty: `GET /learn/api/public/v1/users/{id}/courses`.
Current/historical split (`BBModel.isCurrentCourse`) combines availability,
course date window, term window (`GET /learn/api/v1/terms`, best-effort),
enrollment recency; course-code year is a tiebreaker only.

## Instructors
Students get 404 on the course roster, so two student-readable probes run in order and
stop at the first that yields instructors: `ultra-course`
(`GET /learn/api/v1/courses/{id}?expand=instructorsMembership`) then `public-memberships`
(`GET /learn/api/public/v1/courses/{id}/users?role=Instructor&expand=user`). The one that
answered is stored as `course.instructor_source`. Teaching assistants are excluded by a
word-boundary role match. Probe misses are recorded as `probe_*` diagnostics statuses and are
not counted in `failed_sources`. Name + email kept; email redacted under `--redact`.

## Content / materials
`GET /learn/api/public/v1/courses/{id}/contents` (paged); Ultra's
`GET /learn/api/v1/courses/{id}/contents` is the fallback. Folders (`hasChildren`) are walked via
`.../contents/{contentId}/children`. Records keep content ID, parent ID, breadcrumb path, friendly type
from `contentHandler` IDs, plain-text `body_text` (+ `body_html`), availability window,
created/modified, Ultra URL, and external/LTI link targets. Attachments come from
`GET .../contents/{contentId}/attachments` and carry id/name/mime/size and a `download_url`
(metadata only; files are NOT downloaded). The `attachments:<courseId>` diagnostics source is
`ok` or `partial` with `truncated` and `listing_errors`.

## Announcements
`GET /learn/api/v1/courses/{id}/announcements` (paged).
Body goes through `BBUtils.extractRichText`, which handles both string bodies
and object bodies (`rawText` preferred for text, `displayText` kept as HTML).
This fixes the old `"[object Object]"` bug, which came from assigning an
object directly to `innerHTML`. Stored: title, `body_text`, `body_html`,
`created_at`, `updated_at`, author, course, announcement ID, course URL.

## Gradebook columns → assessments
`GET /learn/api/public/v2/courses/{id}/gradebook/columns` (paged).
Each column becomes an assessment candidate with due/availability dates,
possible points, gradebook category, and `contentId` link. Content-side
assessment candidates (handlers matching assess/assign/test/survey/grade)
are also collected. The two sides merge ONLY on shared Blackboard IDs
(`column_id`/`content_id`/`calendar_id`), never on title similarity.
`BBModel.classifyAssessment` labels Assignment / Quiz / Test / Exam /
Attendance / Manual / Other from category + handler + (last) title signals,
defaulting to Other instead of guessing.

## Grades (student's own only)
Primary (documented): `GET /learn/api/public/v1/courses/{id}/gradebook/users/{userId}`.
Fallback (documented, bounded to 10 columns, concurrency 3):
`GET /learn/api/public/v1/courses/{id}/gradebook/columns/{columnId}/users/{userId}`.
403 (hidden from students) and 404 (no grade yet) are quiet skips.
The path `/learn/api/public/v2/courses/{id}/users/{userId}/grades` (no
`/gradebook/`) 404s and is listed in `KNOWN_BAD_GRADE_PATHS` — it is never
called. When the primary call fails, the per-column fallback fetches the course total column
(`externalGrade`) first so the 10-column cap cannot drop it; it feeds `final_grade`. Grades carry score, possible, computed percentage, status, feedback
(rich-text aware), and posted date, and back-fill their assessment's
grade/percentage/feedback.

## Attempts / submission status
`GET /learn/api/public/v2/courses/{id}/gradebook/columns/{columnId}/users/{userId}/attempts?limit=5`
(bounded: first 10 assessed columns per course). Captures attempt id, status,
submitted timestamp, per-attempt feedback. Non-attempt columns skip quietly.

## Calendar (structured) + ICS (fallback)
Structured: one global sweep, `GET /learn/api/public/v1/calendars/items?since=&until=`, which returns
every course's items and runs alongside the course reads. Only if a window of it fails does the
extractor sweep `?courseId={id}` per in-scope course instead. Both are issued per window of at most
16 weeks (`U.calendarWindows`; a longer range returns HTTP 400). `GradebookColumn` items with `dynamicCalendarItemProps.id` enrich the
matching assessment's due date and `calendar_id`, and calendar items are a due-date fallback.
ICS (kept): user-pasted Share-Calendar URL, parsed by `src/ics.js`, merged as `source: "ics"`.
Timestamps normalized to ISO 8601 UTC via `BBUtils.normalizeTimestamp`.

## Course summary
Each course carries `term_name` (from `GET /learn/api/v1/terms`), `grade_summary`
(`{ earned, possible, percentage, graded, pending, missing }` computed from the student's own
grades; `missing` counts overdue assessments) and `final_grade`
(`{ score, possible, percentage, text }` from the course total column, `null` by default and
whenever that column is hidden or unreadable). The total column is not an assessment.
Assessments also get `is_upcoming`/`is_overdue`; `summary.upcoming_deadlines` and `summary.overdue`
count them.

## Diagnostics
Every source records `{ source, endpoint, status, count, elapsed_ms, error? }`
with credential-stripped errors. The export ends with `summary` plus
`failed_sources` lines, rendered by the popup as:

Courses: 8 current / 62 total / Assessments: 37 / Announcements: 42 /
Grades: 35 / Events: 18 / Content: 91 / Failed sources: …

Debug option: `extractAll({ captureSamples: true })` adds `diagnostics.samples`, the first raw
record per source family (user keys removed, strings truncated to 120 characters). Off by default.
