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
`GET /learn/api/v1/courses/{id}/users?expand=user` (paged) → filter
`courseRoleId` matching instructor/faculty/teacher. Name + email kept;
email redacted under `--redact`.

## Content / materials
`GET /learn/api/v1/courses/{id}/contents` (paged) then, for items with
`hasChildren`, `GET .../contents/{contentId}/children` recursively.
Records keep content ID, parent ID, breadcrumb path, friendly type mapped
from documented `contentHandler` IDs (`x-bb-folder/file/document/externallink/
courselink/forumlink/blti-link/asmt-test-link/assignment`), rich-text
description (`body_text` + `body_html`), availability window, created/modified,
Ultra URL, attachment metadata (id/name/mime/size/URL — metadata only, files
are NOT downloaded), and external/LTI link targets.

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
Fallback (documented, bounded to 10 columns, concurrency 2):
`GET /learn/api/public/v1/courses/{id}/gradebook/columns/{columnId}/users/{userId}`.
403 (hidden from students) and 404 (no grade yet) are quiet skips.
The path `/learn/api/public/v2/courses/{id}/users/{userId}/grades` (no
`/gradebook/`) 404s and is listed in `KNOWN_BAD_GRADE_PATHS` — it is never
called. Grades carry score, possible, computed percentage, status, feedback
(rich-text aware), and posted date, and back-fill their assessment's
grade/percentage/feedback.

## Attempts / submission status
`GET /learn/api/public/v2/courses/{id}/gradebook/columns/{columnId}/users/{userId}/attempts?limit=5`
(bounded: first 10 assessed columns per course). Captures attempt id, status,
submitted timestamp, per-attempt feedback. Non-attempt columns skip quietly.

## Calendar (structured) + ICS (fallback)
Structured (kept): `GET /learn/api/public/v1/calendars/items?courseId={id}&since=&until=`
per in-scope course plus one global sweep. `GradebookColumn` items with
`dynamicCalendarItemProps.id` enrich the matching assessment's due date and
`calendar_id`. ICS (kept): user-pasted Share-Calendar URL, parsed by
`src/ics.js`, merged as `source: "ics"` events. Timestamps normalized to
ISO 8601 UTC via `BBUtils.normalizeTimestamp` (instant preserved, e.g.
`+03:00` → `Z`).

## Diagnostics
Every source records `{ source, endpoint, status, count, elapsed_ms, error? }`
with credential-stripped errors. The export ends with `summary` plus
`failed_sources` lines, rendered by the popup as:

Courses: 8 current / 62 total / Assessments: 37 / Announcements: 42 /
Grades: 35 / Events: 18 / Content: 91 / Failed sources: …
