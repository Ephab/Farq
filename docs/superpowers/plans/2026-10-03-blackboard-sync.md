# Blackboard Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In My Data, the student types their IAU username and password once and clicks **Sync my Blackboard data**. Waypoint then signs in headlessly, runs the improved BB-Extension extractor, reads attached files, stores everything for Hermes and Today, suggests course evidence for review, and re-syncs every 6 hours.

**Architecture:**
- **Extension (JS):** BB-Extension's `src/` extractor is improved. It returns working deadlines, instructors, plain text, attachment download URLs and grade summaries. It stays the single extraction codebase.
- **Backend sync package (`services/api/app/blackboard_sync/`):**
  - Python Playwright signs in through IAU's AD FS form.
  - It injects that same extractor into the logged-in page, downloads selected attachments into memory and extracts their text.
  - It upserts `blackboard_*` tables and creates `suggested` course evidence.
  - A worker thread runs one sync per student. A 10-minute async tick starts due re-syncs.
- **Frontend:** a React card in the sources step, plus a deadlines panel in Today.

**Tech Stack:** Plain JS (Node test runner), FastAPI + SQLAlchemy 2 + SQLite, `playwright` (sync API, Chromium), `cryptography.Fernet`, pypdf / python-pptx / python-docx, React + TypeScript + Tailwind, en/ar i18n catalogs.

**Spec:** `docs/superpowers/specs/2026-10-03-blackboard-sync-design.md`

## Global Constraints

- All requests to Blackboard are `GET`, except the AD FS form submit (`#submitButton` on `iauauth.iau.edu.sa/adfs/ls`).
- The student login entry is `https://vle.iau.edu.sa/auth-saml/saml/login?apId=_179_1&redirectUrl=https%3A%2F%2Fvle.iau.edu.sa%2Fultra`. Never store or replay a `SAMLRequest` URL.
- AD FS selectors: `#userNameInput`, `#passwordInput`, `#submitButton`, `#errorText`.
- Secrets (`password_enc`, `session_enc`) are sealed with `WAYPOINT_TOKEN_ENCRYPTION_KEY` via `app/outlook/auth.py` `seal`/`unseal`.
- Secrets never reach:
  - an API response,
  - a log line,
  - Hermes,
  - `summary_json`,
  - an exception message.
- `remember=false` drops the password after one login; the session is still kept.
- 3 consecutive bad-password results wipe the saved password. A saved password that fails even once is wiped immediately, and automatic retries stop.
- Attachment bytes are never written to disk or the DB. Only redacted text is kept. Caps: 15 MB per file, 60 files per sync, 40,000 characters per file.
- Periodic re-sync every 6 h. Unreachable portal → retry in 1 h. Hard extractor timeout: 8 min.
- Synced rows use `BlackboardCourse.source_kind = "blackboard_live"`. The first live sync deletes that student's `blackboard_demo` rows.
- Only course-level records become `EvidenceItem` rows, always `status="suggested"`. Nothing becomes a `StudentFact` automatically.
- The Blackboard connector switch in `disabled_connectors` makes `POST .../blackboard/sync` return 409 and stops periodic sync.
- Failure codes (the UI localizes them, and the server never sends prose for them):
  `bad_password | extra_verification | unreachable | needs_login | browser_missing | extract_failed | interrupted`.
- Every new UI string goes in both `src/locales/en/*` and `src/locales/ar/*`, or `tsc` fails.
- Git: commit to local `main`. Never push or open PRs unless asked.
- Never commit `iau-blackboard-export-*.json` (it contains the student's real grades).

## Review Focus

- **The portal's JSON shapes differ from what we assume.** This happened already: content came back with `handler: null`.
  - Expected: the export still succeeds and degrades per section; diagnostics show which path worked.
  - Pinned by: the Task 3 mock using the documented public-API content shape, and the Task 2 test that a probe miss is not counted as a failure.
- **A wrong saved password must never be retried automatically.** Retrying could lock the student's IAU account.
  - Expected: one failure wipes the saved password and stops the loop.
  - Pinned by: `test_saved_password_rejected_is_wiped_and_loop_stops` (Task 9).
- **An empty or broken export must never wipe the student's existing Blackboard data.**
  - Expected: ingest refuses an export with no courses, and deletes stale items only for sources that reported `ok`.
  - Pinned by: `test_empty_export_keeps_existing_rows` and `test_failed_source_keeps_old_items` (Task 6).
- **The password must not leak through an error path** (a validation error echo, an exception message, a log line).
  - Expected: the password never appears in any response body or log record.
  - Pinned by: `test_password_never_in_responses_or_logs` and `test_overlong_password_not_echoed` (Task 9).
- **Two clicks, or a click during a periodic sync, must not start two Chromium sessions.**
  - Expected: the second request returns the running job's status.
  - Pinned by: `test_second_post_while_running_is_single_flight` (Task 9).

---

## File Structure

**BB-Extension (tracked in git from Task 1)**
- `BB-Extension/src/bb-utils.js`: add `calendarWindows`, `findKey`, and a block-aware `htmlToText`.
- `BB-Extension/src/bb-model.js`: add `deadlineFlags`, `instructorsFrom`, `gradeSummary`.
- `BB-Extension/src/extractor.js`:
  - calendar windows and due-date fallbacks;
  - instructor probes;
  - public-API contents with attachments and categories;
  - plain-text bodies;
  - course summaries;
  - failed-source classification;
  - `captureSamples`.
- `BB-Extension/tools/build-console.js` (new): generates `tools/extract-console.js` from `src/`, replacing the hand-maintained copy.
- `BB-Extension/test/unit-tests.js`, `BB-Extension/test/mock-extract.js`: new cases.
- `BB-Extension/README.md`, `BB-Extension/docs/CURRENT-EXTRACTION.md`: document the changes.

**Backend (`services/api/app/`)**
- `models.py`: add `BlackboardGrade` and `BlackboardConnection`; add columns on `BlackboardCourse` / `BlackboardContentItem`.
- `database.py`: `ADDED_COLUMNS` entries.
- `blackboard_sync/__init__.py`: package marker.
- `blackboard_sync/credentials.py`: seal, unseal and forget the password and session.
- `blackboard_sync/files.py`: attachment selection and text extraction.
- `blackboard_sync/ingest.py`: export → tables + suggested evidence.
- `blackboard_sync/browser.py`: `PlaywrightBrowser`, `LoginFailure`, `ExtractFailure`, `classify_after_submit`.
- `blackboard_sync/worker.py`: single-flight job, failure policy, periodic tick.
- `blackboard_sync/routes.py`: `POST`/`GET .../blackboard/sync`, `DELETE .../blackboard/connection`, `GET .../blackboard/deadlines`.
- `main.py`: include the router; start and stop the loop; reset interrupted jobs.
- `blackboard.py`: Hermes-facing dicts expose live fields; `list_content` orders assignments by due date; status reflects live data.
- `hermes_connectors.py`: drop "snapshot" from the label.

**Tests (`services/api/tests/`)**
- `fixtures/blackboard-export-sample.json` (new): a small, synthetic export in the improved shape.
- `test_blackboard_sync.py` (new): credentials, files, ingest, worker, routes, Hermes surface.
- `test_blackboard_browser.py` (new): `classify_after_submit`, plus a fake-portal Playwright test that skips when Chromium is missing.

**Setup / docs**
- `pyproject.toml` + `uv.lock`: add `playwright`.
- `scripts/setup_local.py`: install Chromium.
- `Dockerfile`: add Chromium and the extractor bundle.
- `.gitignore`: ignore the export file.
- `docs/blackboard-threat-model.md` (new), `AGENTS.md`, `docs/handoff.md`.

**Frontend (`src/`)**
- `lib/waypoint-api.ts`: `BlackboardSyncStatus`, `BlackboardDeadline` types.
- `components/onboarding/BlackboardSyncCard.tsx` (new).
- `components/dashboard/BlackboardDeadlines.tsx` (new).
- `components/onboarding/SourcesStep.tsx`: render the card.
- `components/dashboard/TodayView.tsx`: render the deadlines panel.
- `locales/en/blackboard.ts`, `locales/ar/blackboard.ts` (new); `locales/{en,ar}/index.ts`; `locales/{en,ar}/core.ts` (`sourceKinds.blackboard`); `locales/{en,ar}/agent.ts` (drop "demo snapshot").

---

### Task 1: Track the extension; fix calendar windows, due dates and deadline flags

The real export got HTTP 400 on all 63 calendar calls: the window was 210 days, and Blackboard caps it at 16 weeks. 231 of 341 assessments had no due date.

**Files:**
- Modify: `.gitignore` (repo root)
- Modify: `BB-Extension/src/bb-utils.js`, `BB-Extension/src/bb-model.js`, `BB-Extension/src/extractor.js`
- Test: `BB-Extension/test/unit-tests.js`, `BB-Extension/test/mock-extract.js`

**Interfaces:**
- Produces:
  - `BBUtils.calendarWindows(since: string, until: string, maxDays = 112) -> {since, until}[]`
  - `BBUtils.findKey(obj, keys: string[], maxDepth = 4) -> any | null`
  - `BBModel.deadlineFlags(assessment, nowMs) -> {is_upcoming: boolean, is_overdue: boolean}`
  - Every exported assessment carries `is_upcoming` and `is_overdue`.
  - `summary.upcoming_deadlines` and `summary.overdue` (numbers).

- [ ] **Step 1: Track the extension and keep the real export out of git**

Append to the repo-root `.gitignore`:

```gitignore
# Real Blackboard exports contain a student's grades (see BB-Extension/.gitignore)
iau-blackboard-export-*.json
```

Run:

```bash
git add .gitignore BB-Extension && git status --short
```

Expected: `BB-Extension/...` files are staged. `iau-blackboard-export-2026-10-03.json` is NOT listed.

```bash
git commit -m "chore: track BB-Extension in the repo; ignore real exports"
```

- [ ] **Step 2: Write failing unit tests**

In `BB-Extension/test/unit-tests.js`, insert this block just before the line `if (failures) { console.error(`:

```js
  // ---- calendar windows (Blackboard rejects > 16 weeks with HTTP 400) ----
  {
    const w = U.calendarWindows("2026-06-05T00:00:00.000Z", "2027-04-01T00:00:00.000Z");
    assert(w.length === 3, "calendar windows: 300 days -> 3 windows", w);
    assert(w.every((x) => Date.parse(x.until) - Date.parse(x.since) <= 112 * 864e5), "calendar windows: each <= 112 days", w);
    assert(w[0].since === "2026-06-05T00:00:00.000Z" && w[w.length - 1].until === "2027-04-01T00:00:00.000Z", "calendar windows: cover the whole range");
    assert(U.calendarWindows("bad", "2027-01-01").length === 0, "calendar windows: invalid input -> []");
  }

  // ---- findKey (due dates hide in handler-specific shapes) ----
  {
    const item = { contentDetail: { "resource/x-bb-asmt-test-link": { test: { deploymentSettings: { dueDate: "2026-11-01T20:59:00.000Z" } } } } };
    assert(U.findKey(item, ["dueDate"]) === "2026-11-01T20:59:00.000Z", "findKey: nested dueDate found");
    assert(U.findKey({ a: { b: { c: { d: { e: { dueDate: "x" } } } } } }, ["dueDate"], 3) === null, "findKey: depth bounded");
    assert(U.findKey(null, ["dueDate"]) === null, "findKey: null safe");
  }

  // ---- deadline flags ----
  {
    const now = Date.parse("2026-10-03T00:00:00.000Z");
    const f = (a) => M.deadlineFlags(a, now);
    assert(f({ due_date: "2026-10-10T00:00:00.000Z" }).is_upcoming === true, "deadline: future + not done -> upcoming");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z" }).is_overdue === true, "deadline: past + not done -> overdue");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", submission_status: "NeedsGrading" }).is_overdue === false, "deadline: submitted is not overdue");
    assert(f({ due_date: "2026-10-10T00:00:00.000Z", grade: "9/10" }).is_upcoming === false, "deadline: graded is not upcoming");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", type: "Attendance" }).is_overdue === false, "deadline: attendance never overdue");
    assert(f({ due_date: null }).is_upcoming === false && f({}).is_overdue === false, "deadline: no due date -> no flags");
  }
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `node BB-Extension/test/unit-tests.js`

Expected: FAIL with `U.calendarWindows is not a function`, or `FATAL: TypeError`.

- [ ] **Step 4: Implement the helpers**

In `BB-Extension/src/bb-utils.js`, add these functions before `const api = {`:

```js
  // Blackboard's calendar API rejects ranges longer than 16 weeks (HTTP 400).
  const MAX_CALENDAR_DAYS = 112;
  function calendarWindows(since, until, maxDays = MAX_CALENDAR_DAYS) {
    const out = [];
    let start = Date.parse(since);
    const end = Date.parse(until);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return out;
    const step = maxDays * 864e5;
    while (start < end) {
      const stop = Math.min(start + step, end);
      out.push({ since: new Date(start).toISOString(), until: new Date(stop).toISOString() });
      start = stop;
    }
    return out;
  }

  // First non-empty value under any of `keys`, breadth-first and depth-bounded.
  // Blackboard nests due dates in handler-specific contentDetail shapes.
  function findKey(obj, keys, maxDepth = 4) {
    let level = [obj];
    for (let depth = 0; depth <= maxDepth && level.length; depth++) {
      const next = [];
      for (const o of level) {
        if (!o || typeof o !== "object") continue;
        for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
        for (const v of Object.values(o)) if (v && typeof v === "object") next.push(v);
      }
      level = next;
    }
    return null;
  }
```

Change the `api` object to:

```js
  const api = {
    extractRichText, htmlToText, normalizeTimestamp, getJson, pagedGet,
    limitedMap, sanitizeError, isTransientStatus, sleep, calendarWindows, findKey
  };
```

In `BB-Extension/src/bb-model.js`, add before `const api = {`:

```js
  // Submitted/graded work is never "overdue"; attendance columns are not deadlines.
  const DONE_STATUS = /^(graded|needsgrading|needs_grading|submitted|completed|inprogress|in_progress)$/i;
  function deadlineFlags(a, nowMs) {
    const due = a && a.due_date ? Date.parse(a.due_date) : NaN;
    if (Number.isNaN(due) || (a && a.type === "Attendance")) return { is_upcoming: false, is_overdue: false };
    const done = DONE_STATUS.test(String(a.submission_status || "")) ||
      (Array.isArray(a.attempts) && a.attempts.length > 0) || (a.grade != null && a.grade !== "");
    return { is_upcoming: !done && due >= nowMs, is_overdue: !done && due < nowMs };
  }
```

Change its api line to:
`const api = { normKey, classifyAssessment, isCurrentCourse, assessmentMergeKey, mergeAssessments, redactExport, deadlineFlags };`

- [ ] **Step 5: Run the unit tests and verify they pass**

Run: `node BB-Extension/test/unit-tests.js`

Expected: `All unit tests passed.`

- [ ] **Step 6: Make the mock enforce the 16-week limit and add deadline cases**

In `BB-Extension/test/mock-extract.js`:

1. Add a third column to `cols101.results`, with a future due date and no grade:

```js
      { id: "_col4", name: "Project report", grading: { due: "2099-01-15T20:59:00.000Z" }, score: { possible: 20 }, gradebookCategoryId: "Assignment" },
```

2. Add a non-assessment calendar item to `cal101.results`:

```js
, { id: "_cal2", title: "Lab session", start: "2026-10-05T08:00:00.000Z", end: "2026-10-05T10:00:00.000Z", type: "Course", calendarId: "_101_1", calendarName: "Intro to Computing" }
```

3. Replace the `/learn/api/public/v1/calendars/items` branch in `global.fetch` with:

```js
  if (p === "/learn/api/public/v1/calendars/items") {
    const span = Date.parse(u.searchParams.get("until")) - Date.parse(u.searchParams.get("since"));
    if (!(span > 0) || span > 112 * 864e5) return miss(400); // real Blackboard behaviour
    if (u.searchParams.get("courseId") === "_101_1") return ok(responses.cal101);
    if (u.searchParams.get("courseId") === "_102_1") return ok(responses.cal102);
    return ok(responses.calGlobal);
  }
```

4. After the `check("calendar event normalized", ...)` line, add:

```js
  check("calendar windows never exceed 16 weeks (no 400s)", !all.diagnostics.sources.some((s) => s.source.startsWith("calendar") && s.status === "http_400"));
  check("non-assessment calendar event kept", all.events.some((e) => e.source_id === "cal:_cal2" && e.type === "Course"));
  const quiz = all.assessments.find((a) => a.column_id === "_col2");
  check("ungraded past quiz is overdue", quiz && quiz.is_overdue === true && quiz.is_upcoming === false, quiz);
  const report = all.assessments.find((a) => a.column_id === "_col4");
  check("future ungraded item is upcoming", report && report.is_upcoming === true, report);
  check("graded item neither upcoming nor overdue", a1 && !a1.is_upcoming && !a1.is_overdue, a1);
  check("summary counts deadlines", all.summary.upcoming_deadlines >= 1 && all.summary.overdue >= 1, all.summary);
```

- [ ] **Step 7: Run the mock and verify it fails**

Run: `node BB-Extension/test/mock-extract.js`

Expected: FAIL on `calendar windows never exceed 16 weeks` and on the deadline checks.

- [ ] **Step 8: Use windows, due-date fallbacks and flags in the extractor**

In `BB-Extension/src/extractor.js`:

1. Replace the `since`/`until` defaults, and add `windows` right after them:

```js
    const since = options.since || new Date(Date.now() - 120 * 864e5).toISOString();
    const until = options.until || new Date(Date.now() + 180 * 864e5).toISOString();
    const windows = U.calendarWindows(since, until);
```

2. In the content record (`const rec = {`), replace the `dates:` property with:

```js
            dates: {
              due: U.normalizeTimestamp((item.dates && item.dates.due) || U.findKey(item.contentDetail || {}, ["dueDate", "due"])),
              start: U.normalizeTimestamp(item.dates && item.dates.start),
              end: U.normalizeTimestamp(item.dates && item.dates.end)
            },
```

3. In the gradebook-column assessment push, replace the `due_date:` line with:

```js
          due_date: U.normalizeTimestamp(grading.due || col.due || U.findKey(col, ["dueDate"])),
```

4. Replace the whole `// 3g. structured calendar sweep per course` try/catch with a loop over `windows`. The body of the inner `for (const it of ...)` loop is the existing one, unchanged:

```js
      // 3g. structured calendar sweep per course, in <= 16-week windows (longer -> HTTP 400).
      for (const w of windows) {
        try {
          const cal = await track(`calendar:${cid}`, "GET /learn/api/public/v1/calendars/items",
            () => U.getJson(origin, `/learn/api/public/v1/calendars/items?courseId=${encodeURIComponent(cid)}&since=${encodeURIComponent(w.since)}&until=${encodeURIComponent(w.until)}`, { timeoutMs, retries }));
          for (const it of (cal.results || [])) {
            const dynId = it.dynamicCalendarItemProps && it.dynamicCalendarItemProps.id;
            per.events.push({
              title: it.title || "(event)",
              course: cname, course_id: cid,
              description: U.htmlToText(U.extractRichText(it.description).text),
              start: U.normalizeTimestamp(it.start),
              end: U.normalizeTimestamp(it.end),
              due_date: U.normalizeTimestamp(it.end || it.start),
              type: it.type || null,
              calendar_id: it.id || null,
              uid: it.id || null,
              url: (it.dynamicCalendarItemProps && it.dynamicCalendarItemProps.link) || courseUrl(origin, cid),
              source_id: it.id ? `cal:${it.id}` : null,
              source: "api-calendar"
            });
            if (it.type === "GradebookColumn" && dynId) {
              const ax = per.assessments.find((x) => x.column_id === dynId);
              if (ax) {
                ax.calendar_id = it.id || ax.calendar_id;
                if (!ax.due_date) ax.due_date = U.normalizeTimestamp(it.end || it.start);
              }
            }
          }
        } catch { /* recorded */ }
      }
```

5. Replace the `// ---- 4. global calendar sweep` try/catch the same way (`for (const w of windows) { try { ... } catch { /* recorded */ } }`). Use `since=${encodeURIComponent(w.since)}&until=${encodeURIComponent(w.until)}`, and keep the existing `events.push({...})` body.

6. Directly after `const assessmentsM = M.mergeAssessments(assessments);` add:

```js
    const nowMs = Date.now();
    for (const a of assessmentsM) Object.assign(a, M.deadlineFlags(a, nowMs));
```

7. In `summary`, after `content: contentD.length,` add:

```js
      upcoming_deadlines: assessmentsM.filter((a) => a.is_upcoming).length,
      overdue: assessmentsM.filter((a) => a.is_overdue).length,
```

8. In `assignmentsAlias`, add `is_upcoming: a.is_upcoming, is_overdue: a.is_overdue,` after `type: a.type`. Add a comma after `type: a.type` first.

- [ ] **Step 9: Run the full extension suite**

Run: `node BB-Extension/test/run-tests.js`

Expected: `All tests passed.`

- [ ] **Step 10: Commit**

```bash
git add BB-Extension/src BB-Extension/test
git commit -m "fix(bb-extension): 16-week calendar windows, due-date fallbacks, deadline flags"
```

---

### Task 2: Instructors without the roster 404, and honest failure counts

All 46 roster calls returned 404 for a student. All 16 closed courses returned 403 everywhere, and that inflated `failed_sources` to 189.

**Files:**
- Modify: `BB-Extension/src/bb-model.js`, `BB-Extension/src/extractor.js`
- Test: `BB-Extension/test/unit-tests.js`, `BB-Extension/test/mock-extract.js`

**Interfaces:**
- Produces:
  - `BBModel.instructorsFrom(payload) -> {name, email, userId}[]`
  - `course.instructors` and `course.instructor_source` (the endpoint label that worked, or `null`).
  - Diagnostics statuses `probe_http_<n>` and `forbidden`. Neither counts toward `failed_sources`.

- [ ] **Step 1: Write failing unit tests**

Insert before `if (failures) {` in `unit-tests.js`:

```js
  // ---- instructorsFrom: tolerant of the shapes Blackboard returns ----
  {
    const pub = { results: [
      { userId: "_9_1", courseRoleId: "Instructor", user: { name: { given: "Sara", family: "Ali" }, contact: { email: "s@iau.edu.sa" } } },
      { userId: "_8_1", courseRoleId: "Student", user: { name: { given: "X", family: "Y" } } }
    ] };
    const a = M.instructorsFrom(pub);
    assert(a.length === 1 && a[0].name === "Sara Ali" && a[0].email === "s@iau.edu.sa", "instructors: public memberships shape", a);
    const ultra = { instructorsMembership: [{ user: { givenName: "Omar", familyName: "Saad", emailAddress: "o@iau.edu.sa", id: "_7_1" } }] };
    const b = M.instructorsFrom(ultra);
    assert(b.length === 1 && b[0].name === "Omar Saad" && b[0].email === "o@iau.edu.sa", "instructors: ultra instructorsMembership shape", b);
    assert(M.instructorsFrom(null).length === 0 && M.instructorsFrom({}).length === 0, "instructors: empty input -> []");
  }
```

- [ ] **Step 2: Run and verify the failure**

Run: `node BB-Extension/test/unit-tests.js`

Expected: FAIL with `M.instructorsFrom is not a function`.

- [ ] **Step 3: Implement `instructorsFrom`**

In `bb-model.js`, before `const api = {`:

```js
  // Instructor records from either the public memberships list or Ultra's
  // course `instructorsMembership` expansion. Students are filtered out.
  function instructorsFrom(payload) {
    if (!payload || typeof payload !== "object") return [];
    const rows = Array.isArray(payload.instructorsMembership) ? payload.instructorsMembership
      : Array.isArray(payload.results) ? payload.results
      : Array.isArray(payload) ? payload : [];
    const fromUltra = Array.isArray(payload.instructorsMembership);
    const out = [];
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const role = String(r.courseRoleId || r.role || (r.courseRole && r.courseRole.roleId) || "");
      if (!fromUltra && !/instructor|faculty|teacher|ta\b/i.test(role)) continue;
      const u = r.user || r;
      const nm = u.name || {};
      const name = [nm.given || u.givenName, nm.family || u.familyName].filter(Boolean).join(" ") || u.userName || null;
      const email = (u.contact && u.contact.email) || u.emailAddress || u.email || null;
      if (name || email) out.push({ name, email, userId: r.userId || u.id || null });
    }
    return out;
  }
```

Add `instructorsFrom` to the `api` object.

- [ ] **Step 4: Update the mock to the student-real behaviour**

In `mock-extract.js`:
- Make `/learn/api/v1/courses/_101_1/users` and `/learn/api/v1/courses/_102_1/users` return `miss(404)`. That's what IAU does.
- Add these branches before the final `return miss(404);`:

```js
  if (p === "/learn/api/public/v1/courses/_101_1/users") return miss(403); // students may not list members
  if (p === "/learn/api/v1/courses/_101_1") return ok({ id: "_101_1", instructorsMembership: [{ user: { givenName: "A", familyName: "Prof", emailAddress: "a@iau.edu.sa", id: "_9_1" } }] });
  if (p === "/learn/api/v1/courses/_102_1") return miss(403); // closed course
```

Add checks after `check("instructor extracted", ...)`:

```js
  check("instructor source recorded", all.courses.find((c) => c.id === "_101_1").instructor_source === "ultra-course", all.courses[0]);
  check("old roster path no longer called", !all.diagnostics.sources.some((s) => s.endpoint === "GET /learn/api/v1/courses/{id}/users"));
  check("probe misses and 403s are not failures", !all.diagnostics.failed_sources.some((f) => /probe_|forbidden/.test(f)), all.diagnostics.failed_sources);
```

- [ ] **Step 5: Run and verify the failure**

Run: `node BB-Extension/test/mock-extract.js`

Expected: FAIL on `instructor extracted` and on the three new checks.

- [ ] **Step 6: Replace the roster block and classify statuses**

In `extractor.js`:

1. Replace the `track` helper's catch so that a 403 is recorded as `forbidden`:

```js
      } catch (e) {
        const status = e && e.status === 403 ? "forbidden" : (e && e.status ? `http_${e.status}` : "failed");
        recordSource(source, endpoint, status, 0, Date.now() - t0, e);
        throw e;
      }
```

2. Replace the whole `// 3a. roster -> instructors` try/catch with:

```js
      // 3a. instructors: students get 404 on the roster, so probe student-readable
      // shapes in order and stop at the first that yields instructors.
      const instructorProbes = [
        ["ultra-course", `/learn/api/v1/courses/${encodeURIComponent(cid)}?expand=instructorsMembership`],
        ["public-memberships", `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/users?role=Instructor&expand=user`]
      ];
      course.instructor_source = null;
      for (const [label, path] of instructorProbes) {
        const t0 = Date.now();
        try {
          const payload = await U.getJson(origin, path, { timeoutMs, retries: 1 });
          const found = M.instructorsFrom(payload);
          recordSource(`instructors:${cid}`, `GET ${label}`, found.length ? "ok" : "probe_empty", found.length, Date.now() - t0);
          if (found.length) { course.instructors = found; course.instructor_source = label; break; }
        } catch (e) {
          recordSource(`instructors:${cid}`, `GET ${label}`, `probe_${e && e.status ? `http_${e.status}` : "failed"}`, 0, Date.now() - t0, e);
        }
      }
```

3. Replace the `failedSources` line with:

```js
    // Probe misses and 403s on closed courses are expected, not failures.
    const failedSources = sources.filter((s) => s.status !== "ok" && s.status !== "skipped" && s.status !== "forbidden" && !String(s.status).startsWith("probe_"));
```

- [ ] **Step 7: Run the full suite**

Run: `node BB-Extension/test/run-tests.js`

Expected: `All tests passed.`

- [ ] **Step 8: Commit**

```bash
git add BB-Extension/src BB-Extension/test
git commit -m "feat(bb-extension): instructor probes instead of roster 404; 403/probe misses are not failures"
```

---

### Task 3: Readable content: public contents API, folders, attachments, categories, plain text

In the real export:
- every content item had `handler: null`, depth 0 and no dates;
- 274 of 275 descriptions were `/embedded/` URLs;
- 299 announcements had HTML in `body_text`;
- category IDs made 167 assessments come out as `Other`.

**Files:**
- Modify: `BB-Extension/src/bb-utils.js`, `BB-Extension/src/extractor.js`
- Test: `BB-Extension/test/unit-tests.js`, `BB-Extension/test/mock-extract.js`

**Interfaces:**
- Produces:
  - `BBUtils.htmlToText(html)` keeps line breaks for block tags and decodes entities in Node.
  - Content records gain `embedded_url` and `attachments[]` entries with `{id, name, mime, size, download_url}`. `body_text` is plain text.
  - Assessment `gradebook_category` is a category title when one is resolvable.
  - Announcement `body_text` is plain text; `body_html` keeps the markup.
  - The backend (Task 7) consumes `attachments[].download_url`, using attachment key `"{course_id}:{content_id}:{attachment.id}"`.

- [ ] **Step 1: Write failing unit tests**

Insert before `if (failures) {` in `unit-tests.js`:

```js
  // ---- htmlToText keeps paragraph breaks and decodes entities ----
  {
    const t = U.htmlToText("<h5>QUIZ 1</h5><p>Topics:&nbsp;Backprop &amp; GD</p><ul><li>One</li><li>Two</li></ul>");
    assert(t === "QUIZ 1\nTopics: Backprop & GD\nOne\nTwo", "htmlToText: block breaks + entities", t);
  }
```

Note: the existing test `htmlToText("<p>  a   b\nc </p>") === "a b c"` must still pass. Newlines in the source text are whitespace; only block tags create line breaks.

- [ ] **Step 2: Run and verify the failure**

Run: `node BB-Extension/test/unit-tests.js`

Expected: FAIL on `htmlToText: block breaks + entities`.

- [ ] **Step 3: Replace `htmlToText` in `bb-utils.js`**

```js
  const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'" };
  const BREAK = "\u0001";

  // HTML -> readable plain text. Block tags become line breaks; runs of spaces collapse.
  function htmlToText(html) {
    if (html == null) return null;
    if (typeof html !== "string") {
      const r = extractRichText(html);
      html = r.text;
      if (html == null) return null;
    }
    const marked = String(html).replace(/<br\s*\/?>/gi, BREAK).replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, BREAK);
    let raw = null;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        const div = document.createElement("div");
        div.innerHTML = marked;
        raw = div.textContent || "";
      }
    } catch { raw = null; }
    if (raw == null) {
      raw = marked.replace(/<[^>]+>/g, " ").replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] || m);
    }
    const lines = raw.split(BREAK).map((s) => s.replace(/[\s ]+/g, " ").trim()).filter(Boolean);
    return lines.length ? lines.join("\n") : null;
  }
```

Also update the `document` stub at the top of `mock-extract.js`, so its `textContent` decodes `&nbsp;`/`&amp;` like a browser:

```js
global.document = { createElement: () => ({ set innerHTML(v) { this._h = v; }, get textContent() { return (this._h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"); } }) };
```

- [ ] **Step 4: Run the unit tests**

Run: `node BB-Extension/test/unit-tests.js`

Expected: `All unit tests passed.`

- [ ] **Step 5: Extend the mock with the documented public-API shapes**

In `mock-extract.js`:

1. Add these fixtures to `responses`:

```js
  pubContents101: { results: [
    { id: "_f1", title: "Week 1", contentHandler: { id: "resource/x-bb-folder" }, hasChildren: true, created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", availability: { available: "Yes" } },
    { id: "_c1", title: "Week 1 slides", body: "<p>Hello &amp; welcome</p>", contentHandler: { id: "resource/x-bb-document" }, hasChildren: false, created: "2026-09-02T00:00:00.000Z", modified: "2026-09-03T00:00:00.000Z", availability: { available: "Yes" } }
  ], paging: {} },
  pubChildrenF1: { results: [
    { id: "_file1", title: "Course Syllabus.pdf", body: "https://vle.iau.edu.sa/courses/1/X/content/_file1/embedded/", contentHandler: { id: "resource/x-bb-file", file: { fileName: "Course Syllabus.pdf", mimeType: "application/pdf" } }, hasChildren: false, created: "2026-09-01T00:00:00.000Z", modified: "2026-09-01T00:00:00.000Z" }
  ], paging: {} },
  attachmentsFile1: { results: [{ id: "_att9", fileName: "Course Syllabus.pdf", mimeType: "application/pdf" }] },
  categories101: { results: [{ id: "_cat1", title: "Quizzes" }] },
```

2. Change `_col2` in `cols101` to `gradebookCategoryId: "_cat1"`. It now relies on category lookup to classify as Quiz.

3. Change the column `_col1`'s `description` to `"<p>Do it</p>"`. It's already that; leave it.

4. In `ann101`, change the body to `{ rawText: "<p>Welcome <b>all</b></p>", displayText: "<p>Welcome <b>all</b></p>" }`. That matches the real export, where `rawText` held HTML.

5. Add fetch branches before the final `return miss(404);`:

```js
  if (p === "/learn/api/public/v1/courses/_101_1/contents") return ok(responses.pubContents101);
  if (p === "/learn/api/public/v1/courses/_101_1/contents/_f1/children") return ok(responses.pubChildrenF1);
  if (p === "/learn/api/public/v1/courses/_101_1/contents/_file1/attachments") return ok(responses.attachmentsFile1);
  if (p === "/learn/api/public/v1/courses/_101_1/contents/_c1/attachments") return ok({ results: [] });
  if (p === "/learn/api/public/v1/courses/_102_1/contents") return miss(403);
  if (p === "/learn/api/public/v1/courses/_101_1/gradebook/categories") return ok(responses.categories101);
  if (p === "/learn/api/public/v1/courses/_102_1/gradebook/categories") return miss(403);
```

6. Replace the check `announcement object body -> real text` with:

```js
  check("announcement body_text is plain text", ann && ann.body_text === "Welcome all", ann && ann.body_text);
```

Replace the check `content has parent/path/type/timestamps` with:

```js
  const syl = all.content.find((m) => m.content_id === "_file1");
  check("folder children walked with path + parent", syl && syl.parent_id === "_f1" && syl.path === "Week 1 / Course Syllabus.pdf", syl);
  check("content type from public handler", syl && syl.type === "File" && all.content.some((m) => m.type === "Folder"), syl);
  check("embedded URL is not a description", syl && syl.body_text === null && syl.embedded_url && syl.embedded_url.includes("/embedded/"), syl);
  check("attachment has download_url", syl && syl.attachments.length === 1 && syl.attachments[0].download_url === "https://vle.iau.edu.sa/learn/api/public/v1/courses/_101_1/contents/_file1/attachments/_att9/download", syl && syl.attachments);
  check("content body is plain text", all.content.find((m) => m.content_id === "_c1").body_text === "Hello & welcome");
  check("category title resolves classification", all.assessments.find((a) => a.column_id === "_col2").type === "Quiz" && all.assessments.find((a) => a.column_id === "_col2").gradebook_category === "Quizzes");
```

- [ ] **Step 6: Run and verify the failure**

Run: `node BB-Extension/test/mock-extract.js`

Expected: FAIL on the new content, announcement and category checks.

- [ ] **Step 7: Implement it in `extractor.js`**

1. Add a helper next to `contentTypeOf`, and make `contentTypeOf` accept a string handler:

```js
  function handlerOf(item) {
    const h = item && item.contentHandler;
    return (typeof h === "string" ? h : (h && h.id)) || item && item.handler || "";
  }
```

In `contentTypeOf`, replace the first line with `const h = handlerOf(item);`.

2. Replace the whole `// 3b. contents` try/catch with:

```js
      // 3b. contents: documented public API first (stable shape: contentHandler.id,
      // hasChildren, created/modified); Ultra's internal list is the fallback.
      const contentIndex = new Map(); // contentId -> record
      const contentBases = [
        `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/contents`,
        `/learn/api/v1/courses/${encodeURIComponent(cid)}/contents`
      ];
      let tops = null;
      let base = null;
      for (const b of contentBases) {
        try {
          tops = await track(`contents:${cid}`, `GET ${b.includes("/public/") ? "public" : "ultra"} contents`,
            () => U.pagedGet(origin, b, { limit: 100, maxPages: 5, timeoutMs, retries }));
          base = b;
          break;
        } catch { /* recorded; try the next shape */ }
      }
      const attachmentJobs = [];
      if (tops) {
        const queue = tops.map((t) => ({ item: t, parentId: null, path: [t.title || "(untitled)"] }));
        const seen = new Set();
        while (queue.length) {
          const { item, parentId, path } = queue.shift();
          if (!item || !item.id || seen.has(item.id)) continue;
          seen.add(item.id);
          const handler = handlerOf(item);
          const type = contentTypeOf(item);
          const bodyR = U.extractRichText(item.body);
          const bodyText = U.htmlToText(bodyR.text);
          const embedded = bodyText && /^https?:\/\/\S+\/embedded\/?$/.test(bodyText) ? bodyText : null;
          const created = item.created || item.createdDate;
          const modified = item.modified || item.modifiedDate;
          const rec = {
            course: cname, course_id: cid,
            title: item.title || "(untitled)",
            content_id: item.id,
            source_id: item.id,
            type,
            handler: handler || null,
            parent_id: parentId,
            path: path.join(" / "),
            description: embedded ? null : bodyText,
            body_text: embedded ? null : bodyText,
            body_html: bodyR.html || (typeof item.body === "string" && !embedded ? item.body : null),
            embedded_url: embedded,
            availability: (item.availability && item.availability.available) ?? null,
            available_from: U.normalizeTimestamp(item.availability && item.availability.adaptiveRelease && item.availability.adaptiveRelease.start),
            available_until: U.normalizeTimestamp(item.availability && item.availability.adaptiveRelease && item.availability.adaptiveRelease.end),
            created: U.normalizeTimestamp(created),
            modified: U.normalizeTimestamp(modified),
            dates: {
              due: U.normalizeTimestamp((item.dates && item.dates.due) || U.findKey(item.contentDetail || {}, ["dueDate", "due"])),
              start: U.normalizeTimestamp(item.dates && item.dates.start),
              end: U.normalizeTimestamp(item.dates && item.dates.end)
            },
            url: contentUrl(origin, cid, item.id),
            attachments: [],
            external_link: (item.contentHandler && item.contentHandler.url) || item.externalLink || null
          };
          contentIndex.set(item.id, rec);
          per.content.push(rec);
          if (/x-bb-(file|document|assignment)/.test(handler)) attachmentJobs.push(rec);
          const isFolder = item.hasChildren || /x-bb-(folder|lesson)/.test(handler);
          if (isFolder) {
            try {
              const kids = await U.pagedGet(origin, `${base}/${encodeURIComponent(item.id)}/children`, { limit: 100, maxPages: 5, timeoutMs, retries });
              for (const k of kids) queue.push({ item: k, parentId: item.id, path: [...path, k.title || "(untitled)"] });
            } catch { /* keep what we have */ }
          }
        }
      }

      // 3b'. attachment metadata (documented); bytes are never fetched here.
      await U.limitedMap(attachmentJobs.slice(0, 80), 2, async (rec) => {
        const listPath = `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/contents/${encodeURIComponent(rec.content_id)}/attachments`;
        try {
          const res = await U.getJson(origin, listPath, { timeoutMs, retries: 1 });
          rec.attachments = (res.results || []).map((a) => ({
            id: a.id || null,
            name: a.fileName || a.name || null,
            mime: a.mimeType || null,
            size: a.fileSize ?? a.size ?? null,
            download_url: a.id ? `${origin}${listPath}/${encodeURIComponent(a.id)}/download` : null
          }));
        } catch { /* not every handler has attachments */ }
      }, true);
```

3. Load gradebook categories just before `for (const col of columns) {`:

```js
      // Category titles (columns only carry category IDs) for classification.
      const categoryById = new Map();
      try {
        const cats = await U.pagedGet(origin, `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/gradebook/categories`, { limit: 100, maxPages: 2, timeoutMs, retries: 1 });
        for (const c of cats) if (c && c.id) categoryById.set(c.id, c.title || c.name || null);
      } catch { /* optional */ }
      for (const col of columns) {
        if (!col.gradebookCategory && categoryById.get(col.gradebookCategoryId)) col.gradebookCategory = { title: categoryById.get(col.gradebookCategoryId) };
      }
```

4. In the column assessment push, make `description: U.htmlToText(descR.text),`.

5. In the content-side candidate loop, replace `const h = rec.handler || "";` with `const h = rec.handler || "";`. That's unchanged. Replace `type: M.classifyAssessment({ content: { contentHandler: { id: h } } }),` with:

```js
            type: M.classifyAssessment({ column: { name: rec.title }, content: { contentHandler: { id: h } } }),
```

6. In announcements, change `body_text: r.text,` and `body: r.text,` to `body_text: U.htmlToText(r.text),` and `body: U.htmlToText(r.text),`. Change `body_html: r.html || (typeof a.body === "string" ? a.body : null),` to:

```js
            body_html: r.html || (r.text && /<[a-z]/i.test(r.text) ? r.text : null),
```

7. In grades, change `feedback: fb.text,` to `feedback: U.htmlToText(fb.text),`.

- [ ] **Step 8: Run the full suite**

Run: `node BB-Extension/test/run-tests.js`

Expected: `All tests passed.` If the old `content has parent/path/type/timestamps` check was not replaced, remove it now. The new checks cover it.

- [ ] **Step 9: Commit**

```bash
git add BB-Extension/src BB-Extension/test
git commit -m "feat(bb-extension): public contents API with folders + attachment download URLs, plain-text bodies, category titles"
```

---

### Task 4: Academic picture: terms, grade summaries, final grades

**Files:**
- Modify: `BB-Extension/src/bb-model.js`, `BB-Extension/src/extractor.js`
- Test: `BB-Extension/test/unit-tests.js`, `BB-Extension/test/mock-extract.js`

**Interfaces:**
- Produces:
  - `BBModel.gradeSummary(grades, assessments) -> {earned, possible, percentage, graded, pending, missing}`
  - Each course gains:
    - `term_name: string | null`;
    - `grade_summary` (the shape above);
    - `final_grade: {score, possible, percentage, text} | null`, taken from the `externalGrade: true` column.
  - Task 6 ingest reads exactly these keys.

- [ ] **Step 1: Write failing unit tests**

Insert before `if (failures) {` in `unit-tests.js`:

```js
  // ---- grade summary ----
  {
    const grades = [
      { score: 9, possible: 10, status: "Graded" },
      { score: 4, possible: 5, status: "Graded" },
      { score: null, possible: 5, status: "NeedsGrading" }
    ];
    const s = M.gradeSummary(grades, [{ is_overdue: true }, { is_overdue: false }]);
    assert(s.earned === 13 && s.possible === 15 && s.percentage === 86.7, "grade summary: earned/possible/percentage", s);
    assert(s.graded === 2 && s.pending === 1 && s.missing === 1, "grade summary: counts", s);
    assert(M.gradeSummary([], []).percentage === null, "grade summary: nothing graded -> null percentage");
  }
```

- [ ] **Step 2: Run and verify the failure**

Run: `node BB-Extension/test/unit-tests.js`

Expected: FAIL with `M.gradeSummary is not a function`.

- [ ] **Step 3: Implement `gradeSummary`**

In `bb-model.js`, before `const api = {`:

```js
  // Running standing from the student's own grades (graded items only count).
  function gradeSummary(grades, assessments) {
    let earned = 0, possible = 0, graded = 0, pending = 0;
    for (const g of grades || []) {
      if (typeof g.score === "number" && typeof g.possible === "number" && g.possible > 0) {
        earned += g.score; possible += g.possible; graded++;
      } else if (/needs_?grading/i.test(String(g.status || ""))) pending++;
    }
    const missing = (assessments || []).filter((a) => a.is_overdue).length;
    const round = (n) => Math.round(n * 10) / 10;
    return { earned: round(earned), possible: round(possible), percentage: possible ? round((earned / possible) * 100) : null, graded, pending, missing };
  }
```

Add `gradeSummary` to the `api` object.

- [ ] **Step 4: Extend the mock**

In `mock-extract.js`:
- In `responses.terms.results[0]`, add `name: "Fall 2026"`.
- Add a total column to `cols101.results`: `{ id: "_total", name: "Total", externalGrade: true, score: { possible: 100 } }`.
- Add `{ columnId: "_total", userId: "_1_1", status: "Graded", score: 88, displayGrade: { score: 88, possible: 100, text: "B+" } }` to `userGrades101.results`.

Add the checks after `check("summary counts deadlines", ...)`:

```js
  const c101 = all.courses.find((c) => c.id === "_101_1");
  check("term name attached", c101.term_name === "Fall 2026", c101);
  check("final grade from external column", c101.final_grade && c101.final_grade.text === "B+" && c101.final_grade.percentage === 88, c101.final_grade);
  check("grade summary excludes the total column", c101.grade_summary && c101.grade_summary.graded === 1 && c101.grade_summary.possible === 10, c101.grade_summary);
  check("total column is not an assessment", !all.assessments.some((a) => a.column_id === "_total"));
```

- [ ] **Step 5: Run and verify the failure**

Run: `node BB-Extension/test/mock-extract.js`

Expected: FAIL on the four new checks.

- [ ] **Step 6: Implement it in `extractor.js`**

1. In the terms loop, store the name too: `termsById.set(t.id, { name: t.name || null, start: ..., end: ... })`. Keep the existing start/end expressions.

2. In the course `entry`, after `term_id:` add:

```js
        term_name: (termsById.get(c.termId || c.term_id) || {}).name || null,
```

3. Right after `columns = ...` is loaded (before `const columnById`), split off the total column:

```js
      // The course total ("externalGrade") is a final grade, not an assessment.
      const totalColumn = columns.find((c) => c.externalGrade === true) || null;
      columns = columns.filter((c) => c !== totalColumn);
```

Change `const columnById = new Map(columns.map((c) => [c.id, c]));` to also include the total column:

```js
      const columnById = new Map([...columns, ...(totalColumn ? [totalColumn] : [])].map((c) => [c.id, c]));
```

4. In the grades loop (`for (const gr of userGrades)`), add at the top of the loop body after `if (!gr || typeof gr !== "object") continue;`:

```js
        if (totalColumn && gr.columnId === totalColumn.id) {
          const score = typeof gr.score === "number" ? gr.score : (gr.displayGrade && gr.displayGrade.score) ?? null;
          const possible = (gr.displayGrade && gr.displayGrade.possible) ?? (totalColumn.score && totalColumn.score.possible) ?? null;
          course.final_grade = { score, possible, percentage: percentageOf(score, possible), text: (gr.displayGrade && gr.displayGrade.text) ?? null };
          continue;
        }
```

Before the per-course `return per;`, ensure `if (course.final_grade === undefined) course.final_grade = null;`.

5. After the deadline-flags loop added in Task 1 (`for (const a of assessmentsM) Object.assign(...)`), add:

```js
    for (const c of courses) {
      c.grade_summary = M.gradeSummary(gradesD.filter((g) => g.course_id === c.id), assessmentsM.filter((a) => a.course_id === c.id));
    }
```

`gradesD` is defined a few lines below `assessmentsM`. Move this loop to just after the `const contentD = ...` line.

- [ ] **Step 7: Run the full suite**

Run: `node BB-Extension/test/run-tests.js`

Expected: `All tests passed.`

- [ ] **Step 8: Commit**

```bash
git add BB-Extension/src BB-Extension/test
git commit -m "feat(bb-extension): term names, per-course grade summary and final grade"
```

---

### Task 5: Generated console snippet, debug samples, docs

`tools/extract-console.js` is a hand-maintained second copy of the pipeline, so it misses every fix above. Generate it from `src/` instead.

**Files:**
- Create: `BB-Extension/tools/build-console.js`
- Replace (generated): `BB-Extension/tools/extract-console.js`
- Modify: `BB-Extension/src/extractor.js` (`captureSamples`), `BB-Extension/test/run-tests.js`, `BB-Extension/test/mock-extract.js`, `BB-Extension/README.md`, `BB-Extension/docs/CURRENT-EXTRACTION.md`, `BB-Extension/manifest.json` (version)

**Interfaces:**
- Produces: `extractAll({captureSamples: true})` adds `diagnostics.samples: {[sourceFamily]: object}`. Each sample is the first raw record with user keys removed and strings truncated to 120 characters. The backend never sets this option.

- [ ] **Step 1: Write the failing checks**

In `test/run-tests.js`, after the `.gitignore` section, add:

```js
// 4b. Console snippet is generated from src/ (no hand-maintained copy drifting).
const built = execFileSync(process.execPath, [path.join(__dirname, "../tools/build-console.js"), "--check"], { encoding: "utf8" });
assert(/up to date/.test(built), "tools/extract-console.js is generated from src/ and up to date");
```

In `mock-extract.js`, before `const fail = checks.filter(...)`, add:

```js
  const dbg = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", captureSamples: true });
  check("captureSamples records raw shapes", dbg.diagnostics.samples && dbg.diagnostics.samples.contents && dbg.diagnostics.samples.contents.id === "_f1", dbg.diagnostics.samples && Object.keys(dbg.diagnostics.samples));
  check("samples strip user keys", !JSON.stringify(dbg.diagnostics.samples).includes("a@iau.edu.sa"));
  check("no samples by default", all.diagnostics.samples === undefined);
```

- [ ] **Step 2: Run and verify the failure**

Run: `node BB-Extension/test/run-tests.js`

Expected: FAIL. `build-console.js` is missing, and the samples checks fail.

- [ ] **Step 3: Implement `captureSamples` in `extractor.js`**

After `const prog = ...`, add:

```js
    const samples = options.captureSamples ? {} : null;
    const USER_KEYS = /^(email|emailAddress|userName|studentId|contact|name|givenName|familyName)$/;
    function sample(family, raw) {
      if (!samples || samples[family] || !raw || typeof raw !== "object") return;
      samples[family] = JSON.parse(JSON.stringify(raw, (k, v) => (USER_KEYS.test(k) ? undefined : (typeof v === "string" ? v.slice(0, 120) : v))));
    }
```

Call `sample(...)` at these points:
- `sample("memberships", memberships[0]);` after memberships load;
- `sample("contents", tops && tops[0]);` after the contents loop picks `tops`;
- `sample("announcements", anns[0]);`
- `sample("columns", columns[0]);`
- `sample("grades", userGrades[0]);`
- inside the calendar window loop, `sample("calendar", (cal.results || [])[0]);`
- inside the attachments job, `sample("attachments", (res.results || [])[0]);`
- inside the instructor probe after `getJson`, `sample(`instructors-${label}`, payload);`

In the `diagnostics:` object of `out`, add `...(samples ? { samples } : {}),`.

- [ ] **Step 4: Write `tools/build-console.js`**

```js
#!/usr/bin/env node
/* Generates tools/extract-console.js from src/ so the console snippet runs the exact
 * extension pipeline. Run after editing src/: node tools/build-console.js
 * --check exits 1 if the committed snippet is stale.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const parts = ["src/bb-utils.js", "src/bb-model.js", "src/ics.js", "src/extractor.js"]
  .map((f) => `// ---- ${f} ----\n${fs.readFileSync(path.join(root, f), "utf8")}`);

const header = `/* IAU Blackboard console extractor — GENERATED by tools/build-console.js from src/. Do not edit.
 * Paste into DevTools on a logged-in https://vle.iau.edu.sa/ultra tab. GET requests only.
 * Options (set before pasting): window.BB_EXTRACT_OPTIONS = { scope: "current"|"all", redact: false, captureSamples: false }
 */
(async function () {
const module = undefined; // force browser globals in the bundled files
`;
const footer = `
const opts = Object.assign({ scope: "current", redact: false }, window.BB_EXTRACT_OPTIONS || {});
const data = await BBExtractor.extractAll({ ...opts, origin: location.origin, onProgress: (m) => console.log("[BB]", m) });
const s = data.summary;
console.log("[BB] Courses: " + s.courses_current + " current / " + s.courses_total + " total · Assessments: " + s.assessments + " · Upcoming: " + s.upcoming_deadlines + " · Overdue: " + s.overdue + " · Announcements: " + s.announcements + " · Grades: " + s.grades + " · Events: " + s.events + " · Content: " + s.content + " · Failed sources: " + s.failed_sources);
const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = "iau-blackboard-export-" + new Date().toISOString().slice(0, 10) + ".json";
a.click();
setTimeout(() => URL.revokeObjectURL(a.href), 5000);
return data;
})();
`;
const out = header + parts.join("\n") + footer;
const target = path.join(root, "tools/extract-console.js");
if (process.argv.includes("--check")) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current !== out) { console.log("stale: run node tools/build-console.js"); process.exit(1); }
  console.log("extract-console.js up to date");
} else {
  fs.writeFileSync(target, out);
  console.log("wrote tools/extract-console.js");
}
```

Run: `node BB-Extension/tools/build-console.js`

Expected: `wrote tools/extract-console.js`.

- [ ] **Step 5: Run the full suite**

Run: `node BB-Extension/test/run-tests.js`

Expected: `All tests passed.` That includes `tools/extract-console.js parses` and `is generated from src/ and up to date`.

- [ ] **Step 6: Update the docs and version**

- `manifest.json`: set `"version": "1.1.0"`.
- `README.md`: add a section `## 2c. v3 improvements` with one bullet per change:
  - calendar windows (≤ 16 weeks; the old 210-day window gave HTTP 400);
  - due-date fallbacks + `is_upcoming`/`is_overdue`;
  - instructor probes (`ultra-course`, `public-memberships`) replacing the 404 roster;
  - 403/probe misses no longer counted as failures;
  - public contents API with folder walking and attachment `download_url` (metadata only; the extension never downloads);
  - plain-text `body_text` with `body_html` kept;
  - category titles;
  - `term_name`, `grade_summary`, `final_grade`;
  - the generated console snippet;
  - `captureSamples`.

  Also add: "Waypoint runs this same `src/` extractor headlessly for its Blackboard sync (`services/api/app/blackboard_sync/`)."
- `docs/CURRENT-EXTRACTION.md`: update the Instructors, Content / materials, Calendar and Grades sections to the endpoints above. Add a "Course summary" section for `grade_summary`/`final_grade`.

- [ ] **Step 7: Commit**

```bash
git add BB-Extension
git commit -m "feat(bb-extension): generated console snippet, captureSamples diagnostics, v3 docs"
```

---

### Task 6: Backend data model and export ingest

**Files:**
- Modify: `services/api/app/models.py` (after `class BlackboardContentItem`), `services/api/app/database.py` (`ADDED_COLUMNS`)
- Create: `services/api/app/blackboard_sync/__init__.py`, `services/api/app/blackboard_sync/ingest.py`
- Create: `services/api/tests/fixtures/blackboard-export-sample.json`
- Test: `services/api/tests/test_blackboard_sync.py`

**Interfaces:**
- Consumes: the export keys from Tasks 1–4. For courses: `id, code, name, term_name, is_current, instructors, grade_summary, final_grade, url`. Also `assessments`, `announcements`, `content` (`attachments[].id`) and `grades`. `diagnostics.sources[].{source,status}` and `summary.failed_sources`.
- Produces:
  - `ingest_export(db: Session, student_id: str, export: dict, file_texts: dict[str, str]) -> IngestSummary`
  - `IngestSummary.as_dict() -> dict` with keys `courses, current_courses, upcoming_deadlines, overdue, announcements, materials, files_read, grades, new_evidence, partial`.
  - `plain(value) -> str`, `course_label(name) -> str`.
  - Models `BlackboardGrade` and `BlackboardConnection` (fields as below).
  - Attachment text keys are `f"{course_id}:{content_id}:{attachment_id}"`.
  - `ingest_export` does NOT commit. The caller commits.

- [ ] **Step 1: Write the fixture**

Create `services/api/tests/fixtures/blackboard-export-sample.json`. It's synthetic: no real student data.

```json
{
  "exported_at": "2026-10-03T00:00:00.000Z",
  "source": "IAU Blackboard",
  "origin": "https://vle.iau.edu.sa",
  "user": {"id": "_1_1", "userName": "student"},
  "courses": [
    {"id": "_101_1", "code": "100_23Aug2026_COMSC", "name": "Deep Learning-7MA1", "term_name": "Fall 2026", "is_current": true,
     "instructors": [{"name": "Sara Ali", "email": "s@iau.edu.sa", "userId": "_9_1"}],
     "grade_summary": {"earned": 9, "possible": 10, "percentage": 90, "graded": 1, "pending": 1, "missing": 1},
     "final_grade": null, "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline"},
    {"id": "_102_1", "code": "102_23Aug2026_COMSC", "name": "Deep Learning-MA01", "term_name": "Fall 2026", "is_current": true,
     "instructors": [], "grade_summary": {"earned": 0, "possible": 0, "percentage": null, "graded": 0, "pending": 0, "missing": 0},
     "final_grade": null, "url": "https://vle.iau.edu.sa/ultra/courses/_102_1/outline"},
    {"id": "_090_1", "code": "090_2025_COMSC", "name": "Machine learning-6MA2", "term_name": "Spring 2026", "is_current": false,
     "instructors": [], "grade_summary": {"earned": 88, "possible": 100, "percentage": 88, "graded": 5, "pending": 0, "missing": 0},
     "final_grade": {"score": 88, "possible": 100, "percentage": 88, "text": "B+"}, "url": "https://vle.iau.edu.sa/ultra/courses/_090_1/outline"}
  ],
  "assessments": [
    {"course_id": "_101_1", "title": "Quiz 1", "description": "Backprop & GD", "due_date": "2026-09-01T20:59:00.000Z", "type": "Quiz",
     "submission_status": null, "grade": null, "possible": 5, "column_id": "_col2", "source_id": "_col2", "is_upcoming": false, "is_overdue": true,
     "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline?contentId=_col2"},
    {"course_id": "_101_1", "title": "Project report", "description": null, "due_date": "2099-01-15T20:59:00.000Z", "type": "Assignment",
     "submission_status": null, "grade": null, "possible": 20, "column_id": "_col4", "source_id": "_col4", "is_upcoming": true, "is_overdue": false,
     "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline?contentId=_col4"}
  ],
  "announcements": [
    {"course_id": "_101_1", "announcement_id": "_a1", "source_id": "_a1", "title": "Quiz 1 (5%)", "body_text": "QUIZ 1\nTopics: Backprop",
     "body_html": "<h5>QUIZ 1</h5>", "created_at": "2026-09-20T08:00:00.000Z", "updated_at": "2026-09-20T08:00:00.000Z",
     "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline"}
  ],
  "content": [
    {"course_id": "_101_1", "content_id": "_f1", "title": "Week 1", "type": "Folder", "path": "Week 1", "body_text": null, "attachments": [],
     "created": "2026-09-01T00:00:00.000Z", "modified": "2026-09-02T00:00:00.000Z", "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline?contentId=_f1"},
    {"course_id": "_101_1", "content_id": "_file1", "title": "Course Syllabus.pdf", "type": "File", "path": "Week 1 / Course Syllabus.pdf", "body_text": null,
     "attachments": [{"id": "_att9", "name": "Course Syllabus.pdf", "mime": "application/pdf", "size": 2048,
                      "download_url": "https://vle.iau.edu.sa/learn/api/public/v1/courses/_101_1/contents/_file1/attachments/_att9/download"}],
     "created": "2026-09-01T00:00:00.000Z", "modified": "2026-09-01T00:00:00.000Z", "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline?contentId=_file1"},
    {"course_id": "_101_1", "content_id": "_c1", "title": "Lecture 3 slides", "type": "Document", "path": "Lecture 3 slides", "body_text": "Hello & welcome",
     "attachments": [], "created": "2026-09-02T00:00:00.000Z", "modified": "2026-09-03T00:00:00.000Z", "url": "https://vle.iau.edu.sa/ultra/courses/_101_1/outline?contentId=_c1"}
  ],
  "grades": [
    {"course_id": "_101_1", "item": "Lab 1", "column_id": "_col1", "score": 9, "possible": 10, "percentage": 90, "status": "Graded",
     "feedback": "Good work", "posted": "2026-09-15T00:00:00.000Z"}
  ],
  "events": [],
  "diagnostics": {"sources": [
    {"source": "contents:_101_1", "status": "ok"}, {"source": "announcements:_101_1", "status": "ok"},
    {"source": "columns:_101_1", "status": "ok"}, {"source": "usergrades:_101_1", "status": "ok"},
    {"source": "contents:_102_1", "status": "ok"}, {"source": "announcements:_102_1", "status": "ok"},
    {"source": "columns:_102_1", "status": "ok"}, {"source": "usergrades:_102_1", "status": "ok"}
  ]},
  "summary": {"failed_sources": 0}
}
```

- [ ] **Step 2: Write failing tests**

Create `services/api/tests/test_blackboard_sync.py`:

```python
import copy
import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-bbsync-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["BLACKBOARD_SYNC_ENABLED"] = "false"

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import BlackboardContentItem, BlackboardCourse, BlackboardGrade, EvidenceItem, Student  # noqa: E402
from app.blackboard_sync import ingest  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "blackboard-export-sample.json"
SYLLABUS_KEY = "_101_1:_file1:_att9"


def sample() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


@pytest.fixture()
def student(client):
    sid = f"bb-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    db.add(Student(id=sid, display_name="BB Student"))
    db.commit()
    db.close()
    return sid


def ingest_sample(sid: str, export: dict | None = None, texts: dict | None = None):
    db = SessionLocal()
    try:
        result = ingest.ingest_export(db, sid, export or sample(), texts or {})
        db.commit()
        return result
    finally:
        db.close()


def rows(model, **where):
    db = SessionLocal()
    try:
        query = select(model)
        for key, value in where.items():
            query = query.where(getattr(model, key) == value)
        return db.scalars(query).all()
    finally:
        db.close()


def test_plain_strips_html_and_entities():
    assert ingest.plain("<h5>QUIZ</h5><p>A &amp; B</p>") == "QUIZ\nA & B"
    assert ingest.plain(None) == ""


def test_course_label_drops_section_suffix():
    assert ingest.course_label("Deep Learning-7MA1") == "Deep Learning"
    assert ingest.course_label("Machine learning-6MA2") == "Machine learning"
    assert ingest.course_label("Ethics") == "Ethics"


def test_ingest_maps_courses_items_grades(student):
    result = ingest_sample(student, texts={SYLLABUS_KEY: "Midterm covers chapters 1-4."})
    courses = {c.external_id: c for c in rows(BlackboardCourse, student_id=student)}
    assert set(courses) == {"_101_1", "_102_1", "_090_1"}
    dl = courses["_101_1"]
    assert dl.source_kind == "blackboard_live" and dl.is_current and dl.term == "Fall 2026"
    assert json.loads(dl.instructors_json)[0]["name"] == "Sara Ali"
    assert json.loads(dl.grade_summary_json)["percentage"] == 90
    items = {i.external_id: i for i in rows(BlackboardContentItem, course_id=dl.id)}
    assert items["ann:_a1"].content_type == "announcement" and "Topics: Backprop" in items["ann:_a1"].body_text
    assert items["asmt:_col4"].content_type == "assignment" and items["asmt:_col4"].due_at is not None
    assert items["content:_file1"].content_type == "syllabus"
    assert "Midterm covers chapters 1-4." in items["content:_file1"].body_text
    assert items["content:_c1"].content_type == "lecture" and items["content:_c1"].body_text == "Hello & welcome"
    assert "content:_f1" not in items  # empty folder rows carry nothing useful
    grade = rows(BlackboardGrade, course_id=dl.id)[0]
    assert grade.score == 9 and grade.possible == 10 and grade.feedback == "Good work"
    assert result.courses == 3 and result.current_courses == 2
    assert result.upcoming_deadlines == 1 and result.overdue == 1 and result.files_read == 1


def test_ingest_suggests_course_evidence_once(student):
    first = ingest_sample(student)
    evidence = rows(EvidenceItem, student_id=student)
    titles = sorted(e.title for e in evidence)
    # Two sections of Deep Learning collapse to one; the completed course carries its grade.
    assert titles == ["Deep Learning", "Machine learning"]
    assert all(e.status == "suggested" for e in evidence)
    completed = next(e for e in evidence if e.title == "Machine learning")
    assert json.loads(completed.data_json)["grade"] == "B+"
    assert first.new_evidence == 2
    assert ingest_sample(student).new_evidence == 0


def test_dismissed_evidence_not_resurrected(student):
    ingest_sample(student)
    db = SessionLocal()
    for e in db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student)).all():
        e.status = "dismissed"
    db.commit()
    db.close()
    ingest_sample(student)
    assert {e.status for e in rows(EvidenceItem, student_id=student)} == {"dismissed"}


def test_first_live_sync_replaces_demo_rows(student):
    db = SessionLocal()
    demo = BlackboardCourse(student_id=student, external_id="ARTI-404", title="Demo", source_kind="blackboard_demo")
    db.add(demo)
    db.commit()
    db.close()
    ingest_sample(student)
    assert "ARTI-404" not in {c.external_id for c in rows(BlackboardCourse, student_id=student)}


def test_empty_export_keeps_existing_rows(student):
    ingest_sample(student)
    empty = sample()
    empty["courses"] = []
    with pytest.raises(ValueError):
        ingest_sample(student, empty)
    assert len(rows(BlackboardCourse, student_id=student)) == 3


def test_failed_source_keeps_old_items(student):
    ingest_sample(student)
    later = sample()
    later["announcements"] = []
    later["diagnostics"]["sources"] = [s for s in later["diagnostics"]["sources"] if s["source"] != "announcements:_101_1"]
    later["diagnostics"]["sources"].append({"source": "announcements:_101_1", "status": "http_500"})
    ingest_sample(student, later)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    assert any(i.external_id == "ann:_a1" for i in rows(BlackboardContentItem, course_id=course.id))


def test_removed_item_deleted_when_source_ok(student):
    ingest_sample(student)
    later = sample()
    later["announcements"] = []
    ingest_sample(student, later)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    assert not any(i.external_id == "ann:_a1" for i in rows(BlackboardContentItem, course_id=course.id))


def test_unchanged_item_keeps_modified_at(student):
    ingest_sample(student)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    before = {i.external_id: i.modified_at for i in rows(BlackboardContentItem, course_id=course.id)}
    ingest_sample(student)
    after = {i.external_id: i.modified_at for i in rows(BlackboardContentItem, course_id=course.id)}
    assert before["asmt:_col4"] == after["asmt:_col4"]
```

- [ ] **Step 3: Run and verify the failure**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.blackboard_sync'`.

- [ ] **Step 4: Add the models and columns**

In `services/api/app/models.py`, add to `class BlackboardCourse` after `source_kind`:

```python
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    instructors_json: Mapped[str] = mapped_column(Text, default="[]")
    grade_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    url: Mapped[str] = mapped_column(String(500), default="")
```

Add to `class BlackboardContentItem` after `source_ref`:

```python
    url: Mapped[str] = mapped_column(String(500), default="")
```

Add after `class BlackboardContentItem`:

```python
class BlackboardGrade(Base):
    __tablename__ = "blackboard_grades"
    __table_args__ = (UniqueConstraint("course_id", "external_id", name="uq_blackboard_grade_course_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("blackboard_courses.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    possible: Mapped[float | None] = mapped_column(Float, nullable=True)
    percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="")
    feedback: Mapped[str] = mapped_column(Text, default="")
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BlackboardConnection(Base):
    """A student's live Blackboard login. Secrets are Fernet-sealed (docs/blackboard-threat-model.md)
    and never leave the server: no response, log line or Hermes tool sees them."""
    __tablename__ = "blackboard_connections"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    username: Mapped[str] = mapped_column(String(120), default="")
    password_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    # idle | queued | logging_in | extracting | reading_files | saving | done | failed
    status: Mapped[str] = mapped_column(String(16), default="idle")
    stage_detail: Mapped[str] = mapped_column(String(200), default="")
    failure_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    summary_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
```

In `services/api/app/database.py`, add to `ADDED_COLUMNS`:

```python
    "blackboard_courses": {
        "is_current": "BOOLEAN NOT NULL DEFAULT 0",
        "instructors_json": "TEXT NOT NULL DEFAULT '[]'",
        "grade_summary_json": "TEXT NOT NULL DEFAULT '{}'",
        "url": "VARCHAR(500) NOT NULL DEFAULT ''",
    },
    "blackboard_content_items": {"url": "VARCHAR(500) NOT NULL DEFAULT ''"},
```

- [ ] **Step 5: Write `ingest.py`**

Create `services/api/app/blackboard_sync/__init__.py`:

```python
"""Live Blackboard sync: headless sign-in, the BB-Extension extractor, and ingest."""
```

Create `services/api/app/blackboard_sync/ingest.py`:

```python
"""Map a BB-Extension export onto Waypoint's Blackboard tables and suggested evidence.

Bulk data (announcements, materials, deadlines, grades) is context for Hermes and Today and never
becomes evidence. Only course-level records become `suggested` EvidenceItems, reviewed like any
other import. Everything from Blackboard is untrusted text. The caller commits.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import BlackboardContentItem, BlackboardCourse, BlackboardGrade, DataSource, now
from ..schemas import EvidenceIn
from ..sources import store_evidence

LIVE = "blackboard_live"
MAX_BODY_CHARS = 120_000
SYLLABUS = re.compile(r"syllabus|course (outline|spec|plan)|خطة المقرر|توصيف", re.I)
LECTURE = re.compile(r"lecture|week\s*\d+|chapter|slides?|محاضرة|الأسبوع", re.I)
SECTION_SUFFIX = re.compile(r"-[0-9A-Z]{2,5}$")
# Item id prefix -> the extractor source whose success allows deleting stale rows.
PREFIX_SOURCE = {"ann:": "announcements", "asmt:": "columns", "content:": "contents"}


@dataclass
class IngestSummary:
    courses: int = 0
    current_courses: int = 0
    upcoming_deadlines: int = 0
    overdue: int = 0
    announcements: int = 0
    materials: int = 0
    files_read: int = 0
    grades: int = 0
    new_evidence: int = 0
    partial: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


def plain(value) -> str:
    """Readable plain text; older exports still carry HTML in body_text."""
    if not value:
        return ""
    text = str(value)
    if "<" in text and ">" in text:
        text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", text)
        text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def course_label(name: str) -> str:
    """'Deep Learning-7MA1' and 'Deep Learning-MA01' are sections of one course."""
    stripped = (name or "").strip()
    return SECTION_SUFFIX.sub("", stripped).strip() or stripped


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _ok_sources(export: dict) -> set[str]:
    return {s.get("source") for s in export.get("diagnostics", {}).get("sources", []) if s.get("status") == "ok"}


def _delete_course(db: Session, course: BlackboardCourse) -> None:
    db.execute(delete(BlackboardContentItem).where(BlackboardContentItem.course_id == course.id))
    db.execute(delete(BlackboardGrade).where(BlackboardGrade.course_id == course.id))
    db.delete(course)


def _items(export: dict, file_texts: dict[str, str], summary: IngestSummary):
    """Yield (course external id, item external id, fields) for every item worth keeping."""
    for a in export.get("announcements", []):
        ident = a.get("announcement_id") or a.get("source_id")
        if not ident:
            continue
        summary.announcements += 1
        yield a.get("course_id"), f"ann:{ident}", {
            "content_type": "announcement", "title": a.get("title") or "(announcement)",
            "body": plain(a.get("body_text") or a.get("body_html")), "url": a.get("url") or "",
            "posted_at": _dt(a.get("created_at")), "due_at": None,
            "modified_at": _dt(a.get("updated_at") or a.get("created_at")),
            "filename": "", "mime_type": "text/plain",
        }
    for a in export.get("assessments", []):
        ident = a.get("source_id") or a.get("column_id") or a.get("content_id")
        if not ident:
            continue
        lines = [f"Type: {a.get('type') or 'Other'}"]
        if a.get("due_date"):
            lines.append(f"Due: {a['due_date']}")
        if a.get("submission_status"):
            lines.append(f"Status: {a['submission_status']}")
        if a.get("grade") or a.get("possible"):
            lines.append(f"Grade: {a.get('grade') or '-'} / {a.get('possible') or '-'}")
        description = plain(a.get("description"))
        if description:
            lines.append(description)
        yield a.get("course_id"), f"asmt:{ident}", {
            "content_type": "assignment", "title": a.get("title") or "(graded item)",
            "body": "\n".join(lines), "url": a.get("url") or "",
            "posted_at": None, "due_at": _dt(a.get("due_date")), "modified_at": None,
            "filename": "", "mime_type": "text/plain",
        }
    for c in export.get("content", []):
        ident = c.get("content_id")
        if not ident:
            continue
        body = plain(c.get("body_text"))
        attachments = c.get("attachments") or []
        for att in attachments:
            text = file_texts.get(f"{c.get('course_id')}:{ident}:{att.get('id')}")
            if text:
                summary.files_read += 1
                body = f"{body}\n\n[File: {att.get('name') or 'attachment'}]\n{text}".strip()
        if c.get("type") == "Folder" and not body and not attachments:
            continue
        label = f"{c.get('title') or ''} {c.get('path') or ''}"
        kind = "syllabus" if SYLLABUS.search(label) else "lecture" if LECTURE.search(label) else "document"
        summary.materials += 1
        first = attachments[0] if attachments else {}
        yield c.get("course_id"), f"content:{ident}", {
            "content_type": kind, "title": c.get("title") or "(untitled)", "body": body,
            "url": c.get("url") or "", "posted_at": _dt(c.get("created")), "due_at": None,
            "modified_at": _dt(c.get("modified")),
            "filename": (first.get("name") or "")[:300], "mime_type": (first.get("mime") or "text/plain")[:120],
        }


def course_evidence(courses: list[dict]) -> list[EvidenceIn]:
    """Current courses and completed courses with a final grade, one per course (not per section)."""
    out: list[EvidenceIn] = []
    seen: set[str] = set()
    for c in courses:
        label = course_label(c.get("name") or "")
        if not label:
            continue
        final = c.get("final_grade") or {}
        standing = c.get("grade_summary") or {}
        data: dict = {"name": label, "term": c.get("term_name") or "", "source": "blackboard"}
        if c.get("is_current"):
            state = "current"
            data["status"] = "in_progress"
            if standing.get("percentage") is not None:
                data["running_percentage"] = standing["percentage"]
        elif final.get("text") or final.get("percentage") is not None:
            state = "completed"
            data["grade"] = final.get("text") or f"{final['percentage']}%"
            if final.get("percentage") is not None:
                data["percentage"] = final["percentage"]
        else:
            continue
        fingerprint = f"blackboard:{state}:{label}"
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        out.append(EvidenceIn(kind="course", title=label[:240], data=data,
                              source_ref=(c.get("url") or "")[:500], fingerprint=fingerprint[:300]))
    return out


def ingest_export(db: Session, student_id: str, export: dict, file_texts: dict[str, str]) -> IngestSummary:
    courses_in = [c for c in export.get("courses", []) if c.get("id")]
    if not courses_in:
        raise ValueError("Blackboard export has no courses; keeping the previous sync")
    summary = IngestSummary(partial=bool(export.get("summary", {}).get("failed_sources")))
    ok_sources = _ok_sources(export)

    for demo in db.scalars(select(BlackboardCourse).where(
            BlackboardCourse.student_id == student_id, BlackboardCourse.source_kind != LIVE)).all():
        _delete_course(db, demo)

    by_ext: dict[str, BlackboardCourse] = {}
    for c in courses_in:
        row = db.scalar(select(BlackboardCourse).where(
            BlackboardCourse.student_id == student_id, BlackboardCourse.external_id == c["id"]))
        if row is None:
            row = BlackboardCourse(student_id=student_id, external_id=c["id"], title=(c.get("name") or c["id"])[:240])
            db.add(row)
            db.flush()
        final = c.get("final_grade")
        row.code = (c.get("code") or "")[:80]
        row.title = (c.get("name") or c["id"])[:240]
        row.term = (c.get("term_name") or "")[:120]
        row.source_kind = LIVE
        row.is_current = bool(c.get("is_current"))
        row.instructors_json = json.dumps([{"name": i.get("name"), "email": i.get("email")} for i in c.get("instructors") or []])
        row.grade_summary_json = json.dumps({**(c.get("grade_summary") or {}), **({"final_grade": final} if final else {})})
        row.url = (c.get("url") or "")[:500]
        row.updated_at = now()
        by_ext[c["id"]] = row
    for stale in db.scalars(select(BlackboardCourse).where(
            BlackboardCourse.student_id == student_id, BlackboardCourse.external_id.not_in(list(by_ext)))).all():
        _delete_course(db, stale)

    seen: dict[str, set[str]] = {ext: set() for ext in by_ext}
    for course_ext, item_ext, fields in _items(export, file_texts, summary):
        course = by_ext.get(course_ext)
        if course is None:
            continue
        seen[course_ext].add(item_ext)
        body = fields.pop("body")[:MAX_BODY_CHARS]
        digest = hashlib.sha256(f"{fields['title']}\n{body}".encode("utf-8")).hexdigest()
        item = db.scalar(select(BlackboardContentItem).where(
            BlackboardContentItem.course_id == course.id, BlackboardContentItem.external_id == item_ext))
        changed = item is None or item.checksum != digest
        if item is None:
            item = BlackboardContentItem(course_id=course.id, external_id=item_ext, content_type=fields["content_type"],
                                         title=fields["title"][:300], checksum=digest)
            db.add(item)
        modified = fields.pop("modified_at")
        for key, value in fields.items():
            setattr(item, key, value[:300] if key == "title" else value)
        item.body_text = body
        item.origin = LIVE
        item.source_ref = f"bb://{course_ext}/{item_ext}"
        item.checksum = digest
        if changed:
            item.modified_at = modified or now()

    for course_ext, course in by_ext.items():
        allowed = {prefix for prefix, source in PREFIX_SOURCE.items() if f"{source}:{course_ext}" in ok_sources}
        for item in db.scalars(select(BlackboardContentItem).where(BlackboardContentItem.course_id == course.id)).all():
            prefix = next((p for p in PREFIX_SOURCE if item.external_id.startswith(p)), None)
            if prefix in allowed and item.external_id not in seen[course_ext]:
                db.delete(item)

    grades_seen: dict[str, set[str]] = {ext: set() for ext in by_ext}
    for g in export.get("grades", []):
        course = by_ext.get(g.get("course_id"))
        ident = g.get("column_id") or g.get("source_id")
        if course is None or not ident:
            continue
        grades_seen[g["course_id"]].add(ident)
        row = db.scalar(select(BlackboardGrade).where(BlackboardGrade.course_id == course.id, BlackboardGrade.external_id == ident))
        if row is None:
            row = BlackboardGrade(course_id=course.id, external_id=ident, title=(g.get("item") or ident)[:300])
            db.add(row)
        row.title = (g.get("item") or ident)[:300]
        row.score, row.possible, row.percentage = g.get("score"), g.get("possible"), g.get("percentage")
        row.status = (g.get("status") or "")[:32]
        row.feedback = plain(g.get("feedback"))
        row.posted_at = _dt(g.get("posted"))
        summary.grades += 1
    for course_ext, course in by_ext.items():
        if f"usergrades:{course_ext}" in ok_sources:
            for row in db.scalars(select(BlackboardGrade).where(BlackboardGrade.course_id == course.id)).all():
                if row.external_id not in grades_seen[course_ext]:
                    db.delete(row)

    current = {c["id"] for c in courses_in if c.get("is_current")}
    summary.courses = len(courses_in)
    summary.current_courses = len(current)
    summary.upcoming_deadlines = sum(1 for a in export.get("assessments", []) if a.get("is_upcoming") and a.get("course_id") in current)
    summary.overdue = sum(1 for a in export.get("assessments", []) if a.get("is_overdue") and a.get("course_id") in current)

    source = db.scalar(select(DataSource).where(DataSource.student_id == student_id, DataSource.kind == "blackboard"))
    if source is None:
        source = DataSource(student_id=student_id, kind="blackboard", label="Blackboard",
                            config_json=json.dumps({"read_only": True}), status="ready")
        db.add(source)
        db.flush()
    source.status, source.error, source.last_synced_at = "ready", None, now()
    summary.new_evidence = store_evidence(db, student_id, source.id, course_evidence(courses_in))
    db.flush()
    return summary
```

- [ ] **Step 6: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q`

Expected: all 10 tests pass.

- [ ] **Step 7: Run the existing Blackboard tests (demo fixture regression)**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard.py -q`

Expected: PASS. The new columns have defaults, so the demo importer is unaffected.

- [ ] **Step 8: Commit**

```bash
git add services/api/app/models.py services/api/app/database.py services/api/app/blackboard_sync services/api/tests/fixtures/blackboard-export-sample.json services/api/tests/test_blackboard_sync.py
git commit -m "feat(blackboard): live-sync data model and export ingest with suggested course evidence"
```

---

### Task 7: Sealed credentials and attachment text

**Files:**
- Create: `services/api/app/blackboard_sync/credentials.py`, `services/api/app/blackboard_sync/files.py`
- Test: `services/api/tests/test_blackboard_sync.py` (append)

**Interfaces:**
- Produces (`credentials`):
  - `can_remember() -> bool`
  - `remember_password(conn, password: str) -> None`
  - `saved_password(conn) -> str | None`
  - `forget_password(conn) -> None`
  - `save_session(conn, state: dict) -> None`
  - `saved_session(conn) -> dict | None`
  - `clear_session(conn) -> None`
- Produces (`files`):
  - `Attachment(key, course_id, content_id, name, url, size)` (frozen dataclass)
  - `select_attachments(export: dict) -> list[Attachment]`
  - `extract_text(name: str, data: bytes) -> str | None`
  - `MAX_FILE_BYTES`, `MAX_FILES`, `MAX_CHARS`

- [ ] **Step 1: Write failing tests (append to `test_blackboard_sync.py`)**

```python
import io  # noqa: E402

from cryptography.fernet import Fernet  # noqa: E402

from app.blackboard_sync import credentials, files  # noqa: E402
from app.models import BlackboardConnection  # noqa: E402


@pytest.fixture()
def fernet_key(monkeypatch):
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())


def test_password_and_session_are_sealed(fernet_key):
    conn = BlackboardConnection(student_id="s1", username="2240000000")
    credentials.remember_password(conn, "hunter2-secret")
    credentials.save_session(conn, {"cookies": [{"name": "BbRouter", "value": "abc"}]})
    assert "hunter2-secret" not in (conn.password_enc or "")
    assert "BbRouter" not in (conn.session_enc or "")
    assert credentials.saved_password(conn) == "hunter2-secret"
    assert credentials.saved_session(conn)["cookies"][0]["value"] == "abc"
    credentials.forget_password(conn)
    credentials.clear_session(conn)
    assert credentials.saved_password(conn) is None and credentials.saved_session(conn) is None


def test_without_key_password_is_not_remembered(monkeypatch):
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", "")
    assert credentials.can_remember() is False
    conn = BlackboardConnection(student_id="s-nokey", username="u")
    credentials.save_session(conn, {"cookies": []})
    assert conn.session_enc is None and credentials.saved_session(conn) == {"cookies": []}  # memory only
    credentials.clear_session(conn)


def test_rotated_key_reads_as_not_saved(fernet_key, monkeypatch):
    conn = BlackboardConnection(student_id="s2", username="u")
    credentials.remember_password(conn, "pw")
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    assert credentials.saved_password(conn) is None


def test_select_attachments_prefers_current_syllabus_and_caps():
    export = sample()
    picked = files.select_attachments(export)
    assert [a.key for a in picked] == [SYLLABUS_KEY]
    assert picked[0].url.endswith("/attachments/_att9/download")
    many = copy.deepcopy(export)
    base = many["content"][1]
    many["content"] = [dict(base, content_id=f"_x{i}", attachments=[dict(base["attachments"][0], id=f"_a{i}", name=f"f{i}.pdf")]) for i in range(90)]
    many["content"].append(dict(base, content_id="_big", attachments=[dict(base["attachments"][0], id="_big", size=files.MAX_FILE_BYTES + 1)]))
    many["content"].append(dict(base, content_id="_zip", attachments=[dict(base["attachments"][0], id="_zip", name="code.zip")]))
    chosen = files.select_attachments(many)
    assert len(chosen) == files.MAX_FILES
    assert not any(a.key.endswith(":_big") or a.key.endswith(":_zip") for a in chosen)


def test_extract_text_from_office_files_redacts_ids():
    from docx import Document
    from pptx import Presentation

    doc = Document()
    doc.add_paragraph("Midterm covers chapters 1-4. Contact 2240003321 for questions about grading policy.")
    buffer = io.BytesIO()
    doc.save(buffer)
    text = files.extract_text("Syllabus.docx", buffer.getvalue())
    assert "Midterm covers chapters 1-4." in text and "2240003321" not in text

    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[1])
    slide.shapes.title.text = "Backpropagation"
    slide.placeholders[1].text = "Chain rule applied layer by layer through the network graph."
    buffer = io.BytesIO()
    deck.save(buffer)
    assert "Chain rule" in files.extract_text("Lecture 3.pptx", buffer.getvalue())


def test_extract_text_rejects_garbage_and_oversize():
    assert files.extract_text("broken.pdf", b"%PDF-not-really") is None
    assert files.extract_text("archive.zip", b"PK...") is None
    assert files.extract_text("huge.txt", b"a" * (files.MAX_FILE_BYTES + 1)) is None
    long = files.extract_text("notes.txt", ("word " * 20_000).encode())
    assert long is not None and len(long) <= files.MAX_CHARS
```

- [ ] **Step 2: Run and verify the failure**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q -k "sealed or key or attachments or extract_text"`

Expected: FAIL with `ImportError: cannot import name 'credentials'`.

- [ ] **Step 3: Write `credentials.py`**

```python
"""Sealed Blackboard secrets. Nothing here is returned by a route, logged, or given to Hermes.

The password and the browser session (cookies) are Fernet-sealed with WAYPOINT_TOKEN_ENCRYPTION_KEY,
the key that already protects Graph tokens. Without a key the password is never kept and the
session lives in this process only. See docs/blackboard-threat-model.md.
"""
from __future__ import annotations

import json
import threading

from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from ..models import BlackboardConnection
from ..outlook.auth import encryption_key, seal, unseal

_lock = threading.Lock()
_volatile_sessions: dict[str, dict] = {}


def can_remember() -> bool:
    try:
        encryption_key()
    except HTTPException:
        return False
    return True


def _open(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return unseal(value)
    except (InvalidToken, HTTPException, ValueError):
        return None  # rotated or missing key: treat as not saved


def remember_password(conn: BlackboardConnection, password: str) -> None:
    conn.password_enc = seal(password)


def saved_password(conn: BlackboardConnection) -> str | None:
    return _open(conn.password_enc)


def forget_password(conn: BlackboardConnection) -> None:
    conn.password_enc = None


def save_session(conn: BlackboardConnection, state: dict) -> None:
    if can_remember():
        conn.session_enc = seal(json.dumps(state))
        return
    with _lock:
        _volatile_sessions[conn.student_id] = state


def saved_session(conn: BlackboardConnection) -> dict | None:
    opened = _open(conn.session_enc)
    if opened:
        try:
            return json.loads(opened)
        except json.JSONDecodeError:
            return None
    with _lock:
        return _volatile_sessions.get(conn.student_id)


def clear_session(conn: BlackboardConnection) -> None:
    conn.session_enc = None
    with _lock:
        _volatile_sessions.pop(conn.student_id, None)
```

- [ ] **Step 4: Write `files.py`**

```python
"""Attachment text for the Blackboard sync. Bytes live only in memory; only redacted text is kept."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass

from ..sources.pdf_text import redact

MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_FILES = 60
MAX_CHARS = 40_000
MAX_PDF_PAGES = 80
TEXT_EXTENSIONS = {".pdf", ".pptx", ".docx", ".txt", ".md"}
SYLLABUS = re.compile(r"syllabus|course (outline|spec|plan)|خطة المقرر|توصيف", re.I)


@dataclass(frozen=True)
class Attachment:
    key: str  # "{course_id}:{content_id}:{attachment_id}" — ingest looks texts up by this
    course_id: str
    content_id: str
    name: str
    url: str
    size: int | None


def _ext(name: str) -> str:
    return "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""


def select_attachments(export: dict) -> list[Attachment]:
    """Readable files, current courses first, syllabi first, newest first; capped."""
    current = {c.get("id") for c in export.get("courses", []) if c.get("is_current")}
    ranked: list[tuple[bool, bool, str, Attachment]] = []
    for item in export.get("content", []):
        for att in item.get("attachments") or []:
            name, url, size = str(att.get("name") or ""), att.get("download_url") or "", att.get("size")
            if not url or not att.get("id") or _ext(name) not in TEXT_EXTENSIONS:
                continue
            if isinstance(size, (int, float)) and size > MAX_FILE_BYTES:
                continue
            ranked.append((
                item.get("course_id") in current,
                bool(SYLLABUS.search(f"{item.get('title') or ''} {name}")),
                item.get("modified") or item.get("created") or "",
                Attachment(f"{item.get('course_id')}:{item.get('content_id')}:{att['id']}", item.get("course_id") or "",
                           item.get("content_id") or "", name, url, int(size) if isinstance(size, (int, float)) else None),
            ))
    ranked.sort(key=lambda row: (row[0], row[1], row[2]), reverse=True)
    return [row[3] for row in ranked[:MAX_FILES]]


def _pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages[:MAX_PDF_PAGES])


def _pptx(data: bytes) -> str:
    from pptx import Presentation
    lines: list[str] = []
    for number, slide in enumerate(Presentation(io.BytesIO(data)).slides, 1):
        lines.append(f"[Slide {number}]")
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False) and shape.text_frame.text.strip():
                lines.append(shape.text_frame.text.strip())
    return "\n".join(lines)


def _docx(data: bytes) -> str:
    from docx import Document
    return "\n".join(paragraph.text for paragraph in Document(io.BytesIO(data)).paragraphs)


def extract_text(name: str, data: bytes) -> str | None:
    if not data or len(data) > MAX_FILE_BYTES:
        return None
    ext = _ext(name)
    try:
        if ext == ".pdf":
            text = _pdf(data)
        elif ext == ".pptx":
            text = _pptx(data)
        elif ext == ".docx":
            text = _docx(data)
        elif ext in {".txt", ".md"}:
            text = data.decode("utf-8", errors="replace")
        else:
            return None
    except Exception:  # damaged, encrypted or mislabelled documents are skipped, never fatal
        return None
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) < 40:
        return None  # scanned PDF or an empty deck
    return redact(text)[:MAX_CHARS]
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/blackboard_sync services/api/tests/test_blackboard_sync.py
git commit -m "feat(blackboard): sealed login/session storage and capped attachment text extraction"
```

---

### Task 8: Headless sign-in and extraction (`browser.py`) + Playwright setup

**Files:**
- Create: `services/api/app/blackboard_sync/browser.py`
- Create: `services/api/tests/test_blackboard_browser.py`
- Modify: `pyproject.toml`, `uv.lock`, `scripts/setup_local.py`, `Dockerfile`

**Interfaces:**
- Consumes: `files.MAX_FILE_BYTES` and `files.Attachment` (Task 7).
- Produces:
  - `LoginFailure(code)`, where `.code` ∈ {`bad_password`, `extra_verification`, `unreachable`, `needs_login`, `browser_missing`}.
  - `ExtractFailure`.
  - `BrowserResult(export: dict, session_state: dict, files: dict[str, tuple[str, bytes]])`. The `files` map is key → (file name, bytes).
  - The `BlackboardBrowser` protocol:
    `run(*, username: str, password: str | None, session_state: dict | None, pick_attachments: Callable[[dict], list[Attachment]], progress: Callable[[str, str], None]) -> BrowserResult`
  - `PlaywrightBrowser(origin=ORIGIN, login_url=LOGIN_URL, bundle_dir: Path | None = None, headless=True, login_wait_ms=LOGIN_WAIT_MS)`
  - `classify_after_submit(url: str, error_text: str | None, origin: str = ORIGIN) -> str`
  - `extractor_dir() -> Path`

- [ ] **Step 1: Add the dependency and the browser install**

```bash
uv add "playwright>=1.47,<2"
```

Expected: `pyproject.toml` and `uv.lock` are updated.

In `scripts/setup_local.py` `main()`, directly after the `subprocess.run([args.uv, "sync", ...])` line, add:

```python
    # Headless Chromium for the Blackboard sync (services/api/app/blackboard_sync/browser.py).
    subprocess.run([str(python), "-m", "playwright", "install", "chromium"], cwd=ROOT, check=True)
```

Before that, confirm that the `python` variable (the venv interpreter) is defined above that point in `main()`. If it's defined later, move this line below its definition.

In `Dockerfile`, after `RUN uv sync --locked --extra cpu --no-dev`, add:

```dockerfile
RUN /app/.venv/bin/python -m playwright install --with-deps chromium
```

After the other `COPY` lines, add:

```dockerfile
COPY BB-Extension/src ./bb-extension/src
ENV WAYPOINT_BB_EXTRACTOR_DIR=/app/bb-extension/src
```

Run:

```bash
.venv/Scripts/python -m playwright install chromium
```

Expected: Chromium downloads (around 150 MB), or reports it's already installed.

- [ ] **Step 2: Write failing tests**

Create `services/api/tests/test_blackboard_browser.py`:

```python
"""Login classification, plus a fake IAU portal driven by real Chromium (skipped if not installed)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import pytest

from app.blackboard_sync import browser
from app.blackboard_sync.files import Attachment


def test_classify_after_submit():
    assert browser.classify_after_submit("https://vle.iau.edu.sa/ultra/course", None) == "ok"
    assert browser.classify_after_submit("https://iauauth.iau.edu.sa/adfs/ls/?x", "Incorrect user ID or password.") == "bad_password"
    assert browser.classify_after_submit("https://iauauth.iau.edu.sa/adfs/ls/mfa", "  ") == "extra_verification"


def test_extractor_dir_points_at_bb_extension(monkeypatch):
    monkeypatch.delenv("WAYPOINT_BB_EXTRACTOR_DIR", raising=False)
    assert (browser.extractor_dir() / "extractor.js").is_file()


PASSWORD = "correct-horse"
FORM = """<html><body><form method="post" action="/adfs/ls/">
<input id="userNameInput" name="u"><input id="passwordInput" name="p" type="password">
<span id="errorText">{error}</span><span id="submitButton" onclick="this.closest('form').submit()">Sign in</span>
</form></body></html>"""


class Portal(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep test output clean
        pass

    def _send(self, status, body=b"", ctype="text/html", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return "bb=1" in (self.headers.get("Cookie") or "")

    def do_GET(self):
        if self.path.startswith("/auth-saml/saml/login"):
            return self._send(302, headers={"Location": "/adfs/ls/"})
        if self.path.startswith("/adfs/ls"):
            return self._send(200, FORM.format(error="").encode())
        if self.path.startswith("/ultra"):
            return self._send(200, b"<html><body>Ultra</body></html>") if self._authed() else self._send(302, headers={"Location": "/auth-saml/saml/login"})
        if self.path == "/learn/api/v1/users/me":
            return self._send(200, b'{"id":"_1_1"}', "application/json") if self._authed() else self._send(302, headers={"Location": "/auth-saml/saml/login"})
        if self.path == "/files/syllabus.txt":
            return self._send(200, b"Week 1 covers gradient descent." * 4, "text/plain") if self._authed() else self._send(403)
        return self._send(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(length).decode())
        if form.get("p") == [PASSWORD]:
            return self._send(302, headers={"Location": "/ultra/course", "Set-Cookie": "bb=1; Path=/"})
        return self._send(200, FORM.format(error="Incorrect user ID or password.").encode())


@pytest.fixture()
def portal(tmp_path):
    pytest.importorskip("playwright.sync_api")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Portal)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "bb-utils.js").write_text("window.BBUtils = {};", encoding="utf-8")
    (bundle / "bb-model.js").write_text("window.BBModel = {};", encoding="utf-8")
    (bundle / "extractor.js").write_text(
        "window.BBExtractor = { extractAll: async (o) => { o.onProgress('Courses: 1'); "
        "return { courses: [{ id: '_1' }], content: [], origin: o.origin }; } };", encoding="utf-8")
    yield origin, bundle
    server.shutdown()


def _make(origin, bundle):
    # Short login wait: the bad-password case would otherwise sit out the 30 s production timeout.
    return browser.PlaywrightBrowser(origin=origin, login_url=f"{origin}/auth-saml/saml/login?apId=_179_1",
                                     bundle_dir=bundle, login_wait_ms=3_000)


def _run(b, password, state=None, picks=None):
    stages = []
    try:
        result = b.run(username="2240000000", password=password, session_state=state,
                       pick_attachments=lambda export: picks or [], progress=lambda s, d: stages.append((s, d)))
    except browser.LoginFailure as failure:
        if failure.code == "browser_missing":
            pytest.skip("Chromium is not installed (python -m playwright install chromium)")
        raise
    return result, stages


def test_fake_portal_login_extract_and_download(portal):
    origin, bundle = portal
    pick = [Attachment("_1:_c:_a", "_1", "_c", "syllabus.txt", f"{origin}/files/syllabus.txt", 100)]
    result, stages = _run(_make(origin, bundle), PASSWORD, picks=pick)
    assert result.export["courses"][0]["id"] == "_1"
    assert result.files["_1:_c:_a"][0] == "syllabus.txt" and b"gradient descent" in result.files["_1:_c:_a"][1]
    assert any(c["name"] == "bb" for c in result.session_state["cookies"])
    assert ("extracting", "Courses: 1") in stages
    assert PASSWORD not in json.dumps(result.session_state)


def test_fake_portal_bad_password(portal):
    origin, bundle = portal
    with pytest.raises(browser.LoginFailure) as caught:
        _run(_make(origin, bundle), "wrong")
    assert caught.value.code == "bad_password"


def test_saved_session_skips_login_and_missing_password_needs_login(portal):
    origin, bundle = portal
    first, _ = _run(_make(origin, bundle), PASSWORD)
    again, _ = _run(_make(origin, bundle), None, state=first.session_state)
    assert again.export["courses"]
    with pytest.raises(browser.LoginFailure) as caught:
        _run(_make(origin, bundle), None, state=None)
    assert caught.value.code == "needs_login"
```

- [ ] **Step 3: Run and verify the failure**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_browser.py -q`

Expected: FAIL with `ImportError: cannot import name 'browser'`.

- [ ] **Step 4: Write `browser.py`**

```python
"""Headless Blackboard session for the student's own sync (docs/blackboard-threat-model.md).

Signs in through IAU's AD FS form, runs the BB-Extension extractor inside the logged-in page, and
downloads chosen attachments into memory. The AD FS form submit is the only non-GET request.
The password is typed into the form and never logged, returned or stored here.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from .files import MAX_FILE_BYTES, Attachment

ORIGIN = "https://vle.iau.edu.sa"
LOGIN_URL = f"{ORIGIN}/auth-saml/saml/login?apId=_179_1&redirectUrl=https%3A%2F%2Fvle.iau.edu.sa%2Fultra"
EXTRACTOR_FILES = ("bb-utils.js", "bb-model.js", "extractor.js")
# IAU AD FS sign-in (iauauth.iau.edu.sa/adfs/ls). The one place to update if the page changes.
SELECTORS = {"username": "#userNameInput", "password": "#passwordInput", "submit": "#submitButton", "error": "#errorText"}
LOGIN_WAIT_MS = 30_000
EXTRACT_TIMEOUT_MS = 8 * 60_000
EXTRACT_SCRIPT = """async ({ origin, timeoutMs }) => {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("extract timed out")), timeoutMs));
  try {
    const data = await Promise.race([
      BBExtractor.extractAll({ origin, scope: "all", onProgress: (m) => window.waypointProgress(String(m)) }),
      timeout,
    ]);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  }
}"""


def extractor_dir() -> Path:
    configured = os.getenv("WAYPOINT_BB_EXTRACTOR_DIR", "").strip()
    return Path(configured) if configured else Path(__file__).resolve().parents[4] / "BB-Extension" / "src"


class LoginFailure(Exception):
    """code: bad_password | extra_verification | unreachable | needs_login | browser_missing"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ExtractFailure(Exception):
    pass


@dataclass
class BrowserResult:
    export: dict
    session_state: dict
    files: dict[str, tuple[str, bytes]] = field(default_factory=dict)


class BlackboardBrowser(Protocol):
    def run(self, *, username: str, password: str | None, session_state: dict | None,
            pick_attachments: Callable[[dict], list[Attachment]],
            progress: Callable[[str, str], None]) -> BrowserResult: ...


def classify_after_submit(url: str, error_text: str | None, origin: str = ORIGIN) -> str:
    """'ok' once back on Ultra; 'bad_password' when AD FS shows an error; otherwise IAU asked for more."""
    if url.startswith(f"{origin}/ultra"):
        return "ok"
    if error_text and error_text.strip():
        return "bad_password"
    return "extra_verification"


class PlaywrightBrowser:
    def __init__(self, origin: str = ORIGIN, login_url: str = LOGIN_URL, bundle_dir: Path | None = None,
                 headless: bool = True, login_wait_ms: int = LOGIN_WAIT_MS):
        self.origin = origin.rstrip("/")
        self.login_url = login_url
        self.bundle_dir = bundle_dir or extractor_dir()
        self.headless = headless
        self.login_wait_ms = login_wait_ms

    def run(self, *, username, password, session_state, pick_attachments, progress) -> BrowserResult:
        try:
            from playwright.sync_api import Error as PlaywrightError, sync_playwright
        except ImportError as exc:
            raise LoginFailure("browser_missing") from exc
        bundle = [(self.bundle_dir / name).read_text(encoding="utf-8") for name in EXTRACTOR_FILES]
        with sync_playwright() as pw:
            try:
                chromium = pw.chromium.launch(headless=self.headless)
            except PlaywrightError as exc:
                raise LoginFailure("browser_missing") from exc
            try:
                context = chromium.new_context(storage_state=session_state) if session_state else chromium.new_context()
                context.set_default_timeout(60_000)
                page = context.new_page()
                page.expose_function("waypointProgress", lambda message: progress("extracting", str(message)[:200]))
                progress("logging_in", "")
                if session_state and self._signed_in(context):
                    page.goto(f"{self.origin}/ultra/course", wait_until="domcontentloaded")
                else:
                    if not password:
                        raise LoginFailure("needs_login")
                    self._login(page, username, password)
                    if not self._signed_in(context):
                        raise LoginFailure("extra_verification")
                progress("extracting", "")
                for source in bundle:
                    # Shadow `module` so the files register browser globals even if the page defines one.
                    page.evaluate(f"() => {{ const module = undefined; {source}\n}}")
                outcome = page.evaluate(EXTRACT_SCRIPT, {"origin": self.origin, "timeoutMs": EXTRACT_TIMEOUT_MS})
                if not outcome.get("ok"):
                    raise ExtractFailure(outcome.get("error") or "extract failed")
                export = outcome["data"]
                progress("reading_files", "")
                downloaded: dict[str, tuple[str, bytes]] = {}
                for attachment in pick_attachments(export):
                    try:
                        response = context.request.get(attachment.url, timeout=60_000)
                    except PlaywrightError:
                        continue
                    if response.ok:
                        body = response.body()
                        if len(body) <= MAX_FILE_BYTES:
                            downloaded[attachment.key] = (attachment.name, body)
                return BrowserResult(export=export, session_state=context.storage_state(), files=downloaded)
            except PlaywrightError as exc:
                raise LoginFailure("unreachable") from exc
            finally:
                chromium.close()

    def _signed_in(self, context) -> bool:
        response = context.request.get(f"{self.origin}/learn/api/v1/users/me",
                                       headers={"Accept": "application/json"}, max_redirects=0)
        return response.status == 200

    def _login(self, page, username: str, password: str) -> None:
        from playwright.sync_api import TimeoutError as PlaywrightTimeout
        page.goto(self.login_url, wait_until="domcontentloaded")
        if page.url.startswith(f"{self.origin}/ultra"):
            return
        try:
            page.wait_for_selector(SELECTORS["username"], timeout=self.login_wait_ms)
        except PlaywrightTimeout:
            raise LoginFailure("extra_verification") from None
        page.fill(SELECTORS["username"], username)
        page.fill(SELECTORS["password"], password)
        page.click(SELECTORS["submit"])
        try:
            page.wait_for_url(re.compile("^" + re.escape(self.origin) + "/ultra"), timeout=self.login_wait_ms)
        except PlaywrightTimeout:
            error = page.locator(SELECTORS["error"])
            text = error.first.inner_text(timeout=2_000) if error.count() else ""
            raise LoginFailure(classify_after_submit(page.url, text, self.origin)) from None
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_browser.py -q`

Expected: 5 passed. If Chromium is missing, 2 pass and 3 are skipped. They must not be skipped on the dev machine after Step 1.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock scripts/setup_local.py Dockerfile services/api/app/blackboard_sync/browser.py services/api/tests/test_blackboard_browser.py
git commit -m "feat(blackboard): headless AD FS sign-in that runs the BB-Extension extractor"
```

---

### Task 9: Worker, failure policy and API routes

**Files:**
- Create: `services/api/app/blackboard_sync/worker.py`, `services/api/app/blackboard_sync/routes.py`
- Modify: `services/api/app/main.py` (router include, startup and shutdown)
- Modify: `services/api/tests/conftest.py` (disable the periodic loop in tests)
- Test: `services/api/tests/test_blackboard_sync.py` (append)

**Interfaces:**
- Consumes: `ingest.ingest_export`, `credentials.*`, `files.select_attachments`, `files.extract_text`, `browser.PlaywrightBrowser`, `LoginFailure`, `ExtractFailure`, `BrowserResult`.
- Produces (`worker`):
  - `browser_factory: Callable[[], BlackboardBrowser]` (tests replace it)
  - `start(student_id, password, remember, *, background=True) -> bool`
  - `is_running(student_id) -> bool`
  - `run_sync(student_id, password, remember) -> None`
  - `due_students(db) -> list[str]`
  - `tick() -> None`
  - `async sync_loop()`
  - `reset_interrupted(db) -> None`
  - `RUNNING_STATES`
- Produces (routes):
  - `GET /api/students/{id}/blackboard/sync` → `BlackboardSyncStatus` JSON:
    `{connected, status, stage_detail, failure_reason, username, has_saved_login, can_remember, last_synced_at, next_sync_at, summary}`
  - `POST` (same path) → 202 + the same shape. Body `{username?, password?, remember?}`.
  - `DELETE /api/students/{id}/blackboard/connection` → `{forgotten: true}`
  - `GET /api/students/{id}/blackboard/deadlines` → `{items: [{id, title, course, due_at, url, overdue}]}`

- [ ] **Step 1: Write failing tests (append to `test_blackboard_sync.py`)**

```python
import logging  # noqa: E402

from app.blackboard_sync import worker  # noqa: E402
from app.blackboard_sync.browser import BrowserResult, ExtractFailure, LoginFailure  # noqa: E402

SECRET = "S3cret-Pa55-word!"


class FakeBrowser:
    """Stands in for Chromium: plays back an outcome and records what it was asked."""
    calls: list[dict] = []
    outcome: object = None

    def run(self, *, username, password, session_state, pick_attachments, progress):
        FakeBrowser.calls.append({"username": username, "password": password, "session": session_state})
        progress("extracting", "Courses: 3")
        if isinstance(FakeBrowser.outcome, Exception):
            raise FakeBrowser.outcome
        export = sample()
        picks = pick_attachments(export)
        return BrowserResult(export=export, session_state={"cookies": [{"name": "BbRouter", "value": "x"}]},
                             # Text bytes under a .txt name: extract_text dispatches on the extension.
                             files={a.key: ("syllabus.txt", b"Syllabus: midterm covers chapters 1-4 and the final covers all.") for a in picks})


@pytest.fixture()
def fake_browser(monkeypatch, fernet_key):
    FakeBrowser.calls, FakeBrowser.outcome = [], None
    monkeypatch.setattr(worker, "browser_factory", FakeBrowser)
    real_start = worker.start
    monkeypatch.setattr(worker, "start", lambda sid, pw, remember, background=True: real_start(sid, pw, remember, background=False))
    return FakeBrowser


def sync(client, sid, **body):
    return client.post(f"/api/students/{sid}/blackboard/sync", json=body or None)


def test_first_sync_with_credentials(client, student, fake_browser):
    response = sync(client, student, username="2240000000", password=SECRET, remember=True)
    assert response.status_code == 202
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["status"] == "done" and status["has_saved_login"] is True
    assert status["summary"]["current_courses"] == 2 and status["summary"]["files_read"] == 1
    assert status["next_sync_at"] is not None
    assert fake_browser.calls[0]["password"] == SECRET


def test_resync_uses_saved_session_and_password(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    assert sync(client, student).status_code == 202
    second = fake_browser.calls[-1]
    assert second["password"] == SECRET and second["session"]["cookies"][0]["name"] == "BbRouter"


def test_remember_false_drops_password_keeps_session(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET, remember=False)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["has_saved_login"] is False and status["status"] == "done"
    sync(client, student)
    assert fake_browser.calls[-1]["password"] is None and fake_browser.calls[-1]["session"]


def test_password_never_in_responses_or_logs(client, student, fake_browser, caplog):
    caplog.set_level(logging.DEBUG)
    bodies = [sync(client, student, username="2240000000", password=SECRET, remember=True).text,
              client.get(f"/api/students/{student}/blackboard/sync").text]
    fake_browser.outcome = LoginFailure("bad_password")
    bodies.append(sync(client, student, username="2240000000", password=SECRET).text)
    bodies.append(client.get(f"/api/students/{student}/blackboard/sync").text)
    assert all(SECRET not in body for body in bodies)
    assert SECRET not in caplog.text


def test_overlong_password_not_echoed(client, student, fake_browser):
    response = sync(client, student, username="u", password=SECRET * 40)
    assert response.status_code == 422 and SECRET not in response.text


def test_saved_password_rejected_is_wiped_and_loop_stops(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    fake_browser.outcome = LoginFailure("bad_password")
    sync(client, student)  # periodic-style resync with the saved password
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["status"] == "failed" and status["failure_reason"] == "bad_password"
    assert status["has_saved_login"] is False and status["next_sync_at"] is None
    db = SessionLocal()
    assert student not in worker.due_students(db)
    db.close()


def test_three_typed_bad_passwords_wipe_everything(client, student, fake_browser):
    fake_browser.outcome = LoginFailure("bad_password")
    for _ in range(3):
        sync(client, student, username="2240000000", password="nope-nope")
    db = SessionLocal()
    conn = db.get(BlackboardConnection, student)
    assert conn.failed_logins == 3 and conn.password_enc is None and conn.session_enc is None
    db.close()


def test_unreachable_keeps_data_and_retries_later(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    fake_browser.outcome = LoginFailure("unreachable")
    sync(client, student)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["failure_reason"] == "unreachable" and status["next_sync_at"] is not None
    assert len(rows(BlackboardCourse, student_id=student)) == 3


def test_extract_failure_is_reported(client, student, fake_browser):
    fake_browser.outcome = ExtractFailure("Not logged into Blackboard")
    sync(client, student, username="2240000000", password=SECRET)
    assert client.get(f"/api/students/{student}/blackboard/sync").json()["failure_reason"] == "extract_failed"


def test_first_sync_needs_credentials(client, student, fake_browser):
    assert sync(client, student).status_code == 422
    assert sync(client, student, username="2240000000").status_code == 422


def test_second_post_while_running_is_single_flight(client, student, fake_browser, monkeypatch):
    sync(client, student, username="2240000000", password=SECRET)
    monkeypatch.setattr(worker, "_running", {student})
    before = len(fake_browser.calls)
    response = sync(client, student)
    assert response.status_code == 202 and len(fake_browser.calls) == before


def test_connector_switch_blocks_sync(client, student, fake_browser):
    from app.student_memory import set_connector
    db = SessionLocal()
    set_connector(db, student, "blackboard", False)
    db.commit()
    db.close()
    assert sync(client, student, username="2240000000", password=SECRET).status_code == 409


def test_forget_wipes_login(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    assert client.delete(f"/api/students/{student}/blackboard/connection").json() == {"forgotten": True}
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["connected"] is False and status["has_saved_login"] is False
    assert len(rows(BlackboardCourse, student_id=student)) == 3  # synced course data stays


def test_other_student_cannot_read_status(client, student, fake_browser):
    response = client.get(f"/api/students/{student}/blackboard/sync", headers={"X-Waypoint-User": "someone-else", "x-test-no-auto": "1"})
    assert response.status_code in {403, 404}


def test_deadlines_endpoint_lists_upcoming_current(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    items = client.get(f"/api/students/{student}/blackboard/deadlines").json()["items"]
    assert [i["title"] for i in items] == ["Project report"]
    assert items[0]["course"] == "Deep Learning-7MA1" and items[0]["overdue"] is False


def test_reset_interrupted_marks_running_rows_failed(client, student):
    db = SessionLocal()
    db.add(BlackboardConnection(student_id=student, username="u", status="extracting"))
    db.commit()
    worker.reset_interrupted(db)
    assert db.get(BlackboardConnection, student).failure_reason == "interrupted"
    db.close()
```

Before writing the ownership test, check how `conftest.py` sets the `X-Waypoint-User` header (the `NO_AUTO` header name), and adjust the header names to match.

- [ ] **Step 2: Run and verify the failure**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q`

Expected: the new tests fail with `ImportError: cannot import name 'worker'`.

- [ ] **Step 3: Write `worker.py`**

```python
"""Background Blackboard sync: one job per student, a failure policy that never locks the IAU
account, and a periodic tick. Failure reasons are codes; the UI words them."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import BlackboardConnection, now
from ..student_memory import disabled_connectors
from . import credentials, files, ingest
from .browser import BlackboardBrowser, ExtractFailure, LoginFailure, PlaywrightBrowser

logger = logging.getLogger(__name__)
SYNC_INTERVAL = timedelta(hours=6)
RETRY_UNREACHABLE = timedelta(hours=1)
MAX_FAILED_LOGINS = 3
TICK_SECONDS = 600
RUNNING_STATES = {"queued", "logging_in", "extracting", "reading_files", "saving"}

browser_factory: Callable[[], BlackboardBrowser] = PlaywrightBrowser
_lock = threading.Lock()
_running: set[str] = set()


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def is_running(student_id: str) -> bool:
    with _lock:
        return student_id in _running


def start(student_id: str, password: str | None, remember: bool, *, background: bool = True) -> bool:
    """Start a sync unless one is already running for this student (single-flight)."""
    with _lock:
        if student_id in _running:
            return False
        _running.add(student_id)
    if background:
        threading.Thread(target=_guarded, args=(student_id, password, remember),
                         name=f"blackboard-{student_id[:8]}", daemon=True).start()
    else:
        _guarded(student_id, password, remember)
    return True


def _guarded(student_id: str, password: str | None, remember: bool) -> None:
    try:
        run_sync(student_id, password, remember)
    except Exception as exc:  # never log the message: it can echo page content
        logger.error("Blackboard sync crashed for %s (%s)", student_id, type(exc).__name__)
        _update(student_id, status="failed", failure_reason="extract_failed", stage_detail="")
    finally:
        with _lock:
            _running.discard(student_id)


def _update(student_id: str, **fields) -> None:
    db = SessionLocal()
    try:
        conn = db.get(BlackboardConnection, student_id)
        if conn is not None:
            for key, value in fields.items():
                setattr(conn, key, value)
            db.commit()
    finally:
        db.close()


def _login_failed(conn: BlackboardConnection, code: str, used_saved_password: bool) -> None:
    conn.status, conn.failure_reason, conn.stage_detail = "failed", code, ""
    conn.next_sync_at = None
    if code == "bad_password":
        conn.failed_logins += 1
        credentials.clear_session(conn)
        # A saved password that IAU rejects is wrong for good (changed password): never retry it.
        if used_saved_password or conn.failed_logins >= MAX_FAILED_LOGINS:
            credentials.forget_password(conn)
    elif code == "needs_login":
        credentials.clear_session(conn)
    elif code == "unreachable":
        conn.next_sync_at = now() + RETRY_UNREACHABLE


def run_sync(student_id: str, password: str | None, remember: bool) -> None:
    db = SessionLocal()
    try:
        conn = db.get(BlackboardConnection, student_id)
        if conn is None:
            return
        conn.status, conn.failure_reason, conn.stage_detail = "logging_in", None, ""
        db.commit()
        saved = None if password else credentials.saved_password(conn)
        try:
            result = browser_factory().run(
                username=conn.username, password=password or saved, session_state=credentials.saved_session(conn),
                pick_attachments=files.select_attachments,
                progress=lambda stage, detail: _update(student_id, status=stage, stage_detail=detail[:200]),
            )
        except LoginFailure as failure:
            db.refresh(conn)
            _login_failed(conn, failure.code, used_saved_password=saved is not None)
            db.commit()
            return
        except ExtractFailure:
            db.refresh(conn)
            conn.status, conn.failure_reason, conn.stage_detail = "failed", "extract_failed", ""
            conn.next_sync_at = now() + RETRY_UNREACHABLE
            db.commit()
            return
        db.refresh(conn)
        conn.failed_logins = 0
        credentials.save_session(conn, result.session_state)
        if password and remember and credentials.can_remember():
            credentials.remember_password(conn, password)
        elif password and not remember:
            credentials.forget_password(conn)
        conn.status = "saving"
        db.commit()
        texts = {key: text for key, (name, data) in result.files.items() if (text := files.extract_text(name, data))}
        try:
            summary = ingest.ingest_export(db, student_id, result.export, texts)
        except ValueError:
            db.rollback()
            conn = db.get(BlackboardConnection, student_id)
            conn.status, conn.failure_reason = "failed", "extract_failed"
            conn.next_sync_at = now() + RETRY_UNREACHABLE
            db.commit()
            return
        conn.summary_json = json.dumps(summary.as_dict())
        conn.status, conn.failure_reason, conn.stage_detail = "done", None, ""
        conn.last_synced_at = now()
        conn.next_sync_at = now() + SYNC_INTERVAL
        db.commit()
    finally:
        db.close()


def due_students(db: Session) -> list[str]:
    current = now()
    rows = db.scalars(select(BlackboardConnection).where(BlackboardConnection.next_sync_at.is_not(None))).all()
    return [row.student_id for row in rows
            if _aware(row.next_sync_at) <= current and row.status not in RUNNING_STATES
            and "blackboard" not in disabled_connectors(db, row.student_id)]


def tick() -> None:
    db = SessionLocal()
    try:
        due = due_students(db)
    finally:
        db.close()
    for student_id in due:
        start(student_id, None, True)


async def sync_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception as exc:
            logger.error("Blackboard periodic sync tick failed (%s)", type(exc).__name__)
        await asyncio.sleep(TICK_SECONDS)


def reset_interrupted(db: Session) -> None:
    """A sync cut off by a restart is reported as failed (retryable), not a spinner forever."""
    for conn in db.scalars(select(BlackboardConnection).where(BlackboardConnection.status.in_(RUNNING_STATES))).all():
        conn.status, conn.failure_reason, conn.stage_detail = "failed", "interrupted", ""
    db.commit()
```

- [ ] **Step 4: Write `routes.py`**

```python
"""My Data > Blackboard: start a sync, read its status, forget the login. Owner-only routes.

Credentials arrive once in the POST body and go straight to the worker; responses never carry them.
Validation is manual so a rejected password is never echoed back in a 422 body."""
from __future__ import annotations

import json
from datetime import timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BlackboardContentItem, BlackboardConnection, BlackboardCourse, Student, now
from ..ownership import OwnedStudent
from ..student_memory import disabled_connectors
from . import credentials, worker

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
MAX_USERNAME = 120
MAX_PASSWORD = 256


class SyncRequest(BaseModel):
    username: str | None = None
    password: str | None = None
    remember: bool = True


def _iso(value) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def status_dict(conn: BlackboardConnection | None) -> dict:
    if conn is None:
        return {"connected": False, "status": "idle", "stage_detail": "", "failure_reason": None, "username": None,
                "has_saved_login": False, "can_remember": credentials.can_remember(),
                "last_synced_at": None, "next_sync_at": None, "summary": {}}
    return {
        "connected": True, "status": conn.status, "stage_detail": conn.stage_detail, "failure_reason": conn.failure_reason,
        "username": conn.username, "has_saved_login": bool(conn.password_enc), "can_remember": credentials.can_remember(),
        "last_synced_at": _iso(conn.last_synced_at), "next_sync_at": _iso(conn.next_sync_at),
        "summary": json.loads(conn.summary_json or "{}"),
    }


@router.get("/api/students/{student_id}/blackboard/sync")
def sync_status(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    return status_dict(db.get(BlackboardConnection, student_id))


@router.post("/api/students/{student_id}/blackboard/sync", status_code=202)
def start_sync(student_id: str, _owner: OwnedStudent, db: Db, body: SyncRequest | None = None) -> dict:
    if db.get(Student, student_id) is None:
        raise HTTPException(404, "Student not found")
    if "blackboard" in disabled_connectors(db, student_id):
        raise HTTPException(409, "Blackboard is turned off in Settings > Connectors.")
    body = body or SyncRequest()
    username = (body.username or "").strip()
    password = body.password or None
    if len(username) > MAX_USERNAME or (password and len(password) > MAX_PASSWORD):
        raise HTTPException(422, "Username or password is too long.")
    if (username and not password) or (password and not username):
        raise HTTPException(422, "Enter both your IAU username and password.")
    conn = db.get(BlackboardConnection, student_id)
    if conn is None:
        if not password:
            raise HTTPException(422, "Enter your IAU username and password.")
        conn = BlackboardConnection(student_id=student_id, username=username)
        db.add(conn)
    elif username:
        if username != conn.username:
            credentials.clear_session(conn)
            credentials.forget_password(conn)
            conn.failed_logins = 0
        conn.username = username
    elif not credentials.saved_password(conn) and not credentials.saved_session(conn):
        raise HTTPException(422, "Sign in again to keep syncing.")
    if not worker.is_running(student_id):
        conn.status, conn.failure_reason, conn.stage_detail = "queued", None, ""
    db.commit()
    worker.start(student_id, password, body.remember)
    db.refresh(conn)
    return status_dict(conn)


@router.delete("/api/students/{student_id}/blackboard/connection")
def forget_connection(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    if worker.is_running(student_id):
        raise HTTPException(409, "A sync is running. Try again in a minute.")
    conn = db.get(BlackboardConnection, student_id)
    if conn is not None:
        credentials.clear_session(conn)
        db.delete(conn)
        db.commit()
    return {"forgotten": True}


@router.get("/api/students/{student_id}/blackboard/deadlines")
def deadlines(student_id: str, _owner: OwnedStudent, db: Db, limit: int = 8) -> dict:
    """Upcoming (and up to 7-day overdue) graded work in current courses, soonest first."""
    from datetime import timedelta
    window_start = now() - timedelta(days=7)
    rows = db.execute(
        select(BlackboardContentItem, BlackboardCourse)
        .join(BlackboardCourse, BlackboardContentItem.course_id == BlackboardCourse.id)
        .where(BlackboardCourse.student_id == student_id, BlackboardCourse.is_current.is_(True),
               BlackboardContentItem.content_type == "assignment", BlackboardContentItem.due_at.is_not(None))
        .order_by(BlackboardContentItem.due_at)
    ).all()
    items = []
    for item, course in rows:
        due = item.due_at if item.due_at.tzinfo else item.due_at.replace(tzinfo=timezone.utc)
        done = any(f"Status: {s}" in item.body_text for s in ("Graded", "NeedsGrading", "Submitted", "Completed"))
        if due < window_start or done:
            continue
        items.append({"id": item.id, "title": item.title, "course": course.title, "due_at": due.isoformat(),
                      "url": item.url, "overdue": due < now()})
        if len(items) >= max(1, min(limit, 20)):
            break
    return {"items": items}
```

The ingest stores `Status: <submission_status>` in the assignment body (Task 6). The deadline filter relies on that. The fixture's quiz is overdue by more than 7 days relative to the real "now", so the test expects only "Project report".

- [ ] **Step 5: Wire it into `main.py`**

1. Imports, next to the other routers:

```python
from .blackboard_sync.routes import router as blackboard_sync_router
from .blackboard_sync.worker import reset_interrupted as reset_blackboard_syncs, sync_loop as blackboard_sync_loop
```

2. After `app.include_router(blackboard_router)`, add `app.include_router(blackboard_sync_router)`.

3. Next to `_outlook_sync_task = None` (module-level globals), add `_blackboard_sync_task: asyncio.Task | None = None`.

4. In `startup()`, inside the `try:` after `seed_coop_catalog(db)`, add `reset_blackboard_syncs(db)`. At the end of `startup()`, add:

```python
    global _blackboard_sync_task
    if os.getenv("BLACKBOARD_SYNC_ENABLED", "true").lower() == "true" and (_blackboard_sync_task is None or _blackboard_sync_task.done()):
        _blackboard_sync_task = asyncio.create_task(blackboard_sync_loop())
```

5. In `shutdown()`, add the same cancel block used for `_opportunity_sync_task`:

```python
    global _blackboard_sync_task
    if _blackboard_sync_task is not None:
        _blackboard_sync_task.cancel()
        try:
            await _blackboard_sync_task
        except asyncio.CancelledError:
            pass
        _blackboard_sync_task = None
```

In `services/api/tests/conftest.py`, next to the other `os.environ` lines, add:

```python
# The Blackboard periodic sync would start real Chromium sessions; tests drive the worker directly.
os.environ["BLACKBOARD_SYNC_ENABLED"] = "false"
```

- [ ] **Step 6: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q`

Expected: all tests pass.

- [ ] **Step 7: Run the full backend suite**

Run: `.venv/Scripts/python -m pytest services/api/tests -q`

Expected: everything passes. Investigate any failures; the startup changes touch every TestClient.

- [ ] **Step 8: Commit**

```bash
git add services/api/app/blackboard_sync services/api/app/main.py services/api/tests/conftest.py services/api/tests/test_blackboard_sync.py
git commit -m "feat(blackboard): single-flight sync worker, lockout-safe failure policy, sync/forget/deadlines routes"
```

---

### Task 10: Hermes sees live courses, deadlines and standing

**Files:**
- Modify: `services/api/app/blackboard.py` (`_course_dict`, `list_courses`, `list_content`, `snapshot_status`)
- Modify: `services/api/app/hermes_connectors.py` (label)
- Test: `services/api/tests/test_blackboard_sync.py` (append)

**Interfaces:**
- Produces:
  - Hermes `list_courses` items gain `is_current`, `instructors` (name + email), `grade_summary` and `url`. `mode` is `"live"` when any course is `blackboard_live`, else `"preindexed_demo"`.
  - `list_content(content_type="assignment")` orders by `due_at`, with nulls last.

- [ ] **Step 1: Write failing tests**

Append to `test_blackboard_sync.py`. These call `_course_dict` and the owner status route directly; the Hermes grant path is already covered by `tests/test_blackboard.py`.

```python
def test_hermes_list_courses_exposes_live_fields(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    from app.blackboard import _course_dict
    db = SessionLocal()
    course = db.scalar(select(BlackboardCourse).where(BlackboardCourse.student_id == student, BlackboardCourse.external_id == "_101_1"))
    data = _course_dict(course)
    db.close()
    assert data["is_current"] is True and data["instructors"][0]["name"] == "Sara Ali"
    assert data["grade_summary"]["percentage"] == 90 and data["url"].endswith("/outline")


def test_status_reports_live_mode(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    status = client.get(f"/api/students/{student}/blackboard/status").json()
    assert status["mode"] == "live" and status["courses"] == 3 and status["last_synced_at"]
```

- [ ] **Step 2: Run and verify the failure**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py -q -k "hermes_list or live_mode"`

Expected: FAIL with `KeyError: 'is_current'`.

- [ ] **Step 3: Implement it in `blackboard.py`**

Replace `_course_dict` with:

```python
def _course_dict(item: BlackboardCourse, count: int | None = None) -> dict:
    result = {
        "id": item.id,
        "external_id": item.external_id,
        "code": item.code,
        "title": item.title,
        "term": item.term,
        "description": item.description,
        "source_kind": item.source_kind,
        "is_current": bool(item.is_current),
        "instructors": json.loads(item.instructors_json or "[]"),
        "grade_summary": json.loads(item.grade_summary_json or "{}"),
        "url": item.url,
        "updated_at": _iso(item.updated_at),
    }
    if count is not None:
        result["content_count"] = count
    return result


def _mode(courses: list[BlackboardCourse]) -> str:
    return "live" if any(course.source_kind == "blackboard_live" for course in courses) else "preindexed_demo"
```

In `list_courses`, replace `"mode": "preindexed_demo"` with `"mode": _mode(list(courses))`.

In `list_content`, replace the `items = db.scalars(query.order_by(...)...)` line with:

```python
    order = ((BlackboardContentItem.due_at.is_(None), BlackboardContentItem.due_at) if content_type == "assignment"
             else (BlackboardContentItem.modified_at.desc(), BlackboardContentItem.title))
    items = db.scalars(query.order_by(*order).limit(limit)).all()
```

Replace the body of `snapshot_status` with:

```python
    _student(db, student_id)
    courses = db.scalars(select(BlackboardCourse).where(BlackboardCourse.student_id == student_id)).all()
    mode = _mode(list(courses))
    kind = "blackboard" if mode == "live" else "blackboard_demo"
    source = db.scalar(select(DataSource).where(DataSource.student_id == student_id, DataSource.kind == kind))
    return {
        "connected": bool(courses),
        "mode": mode,
        "read_only": True,
        "courses": len(courses),
        "last_synced_at": _iso(source.last_synced_at) if source else None,
    }
```

In `hermes_connectors.py`, change `"course materials (Blackboard snapshot)"` to `"course materials (Blackboard)"`.

- [ ] **Step 4: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_blackboard_sync.py services/api/tests/test_blackboard.py services/api/tests/test_hermes_settings.py -q`

Expected: all pass. If `test_blackboard.py` asserts the exact `_course_dict` keys or the old connector label, update those assertions to the new keys and label. The new fields are additive.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/blackboard.py services/api/app/hermes_connectors.py services/api/tests
git commit -m "feat(blackboard): Hermes course tools expose live standing, instructors and due-ordered assignments"
```

---

### Task 11: My Data card, Today deadlines panel, en/ar copy

**Files:**
- Modify: `src/lib/waypoint-api.ts` (types)
- Create: `src/components/onboarding/BlackboardSyncCard.tsx`, `src/components/dashboard/BlackboardDeadlines.tsx`
- Modify: `src/components/onboarding/SourcesStep.tsx` (render the card before the Outlook `<details>`)
- Modify: `src/components/dashboard/TodayView.tsx` (render the panel before the "What moved" `<Reveal>`)
- Create: `src/locales/en/blackboard.ts`, `src/locales/ar/blackboard.ts`
- Modify: `src/locales/en/index.ts`, `src/locales/ar/index.ts`, `src/locales/en/core.ts`, `src/locales/ar/core.ts`, `src/locales/en/agent.ts`, `src/locales/ar/agent.ts`

**Interfaces:**
- Consumes: the Task 9 routes and their JSON shapes.
- Produces: `BlackboardSyncCard({ onReview?: () => void })`, `BlackboardDeadlines()`.

- [ ] **Step 1: Add the types to `src/lib/waypoint-api.ts`**

Add after the `SourceKind` type:

```ts
export type BlackboardFailure = "bad_password" | "extra_verification" | "unreachable" | "needs_login" | "browser_missing" | "extract_failed" | "interrupted"

export interface BlackboardSyncStatus {
  connected: boolean
  status: "idle" | "queued" | "logging_in" | "extracting" | "reading_files" | "saving" | "done" | "failed"
  stage_detail: string
  failure_reason: BlackboardFailure | null
  username: string | null
  has_saved_login: boolean
  can_remember: boolean
  last_synced_at: string | null
  next_sync_at: string | null
  summary: Partial<Record<"courses" | "current_courses" | "upcoming_deadlines" | "overdue" | "announcements" | "materials" | "files_read" | "grades" | "new_evidence", number>> & { partial?: boolean }
}

export interface BlackboardDeadline {
  id: string
  title: string
  course: string
  due_at: string
  url: string
  overdue: boolean
}
```

- [ ] **Step 2: Add the copy (English first)**

Create `src/locales/en/blackboard.ts`:

```ts
export const blackboard = {
  title: "Blackboard",
  subtitle: "Courses, deadlines, announcements, files and grades from IAU Blackboard. Read-only.",
  username: "IAU username",
  password: "Password",
  remember: "Remember my login so Waypoint keeps syncing",
  rememberHint: "Stored encrypted on this computer only. Forget it any time.",
  rememberUnavailable: "Run setup again to enable remembered logins.",
  sync: "Sync my Blackboard data",
  syncNow: "Sync now",
  signInAgain: "Sign in again",
  forget: "Forget my login",
  reviewNew: "Review new items",
  stage: {
    queued: "Starting…",
    logging_in: "Signing in to IAU…",
    extracting: "Reading your courses…",
    reading_files: "Reading course files…",
    saving: "Saving…",
  },
  stats: {
    current_courses: "current courses",
    upcoming_deadlines: "upcoming deadlines",
    overdue: "overdue",
    materials: "materials",
    files_read: "files read",
    new_evidence: "new items to review",
  },
  synced: "Synced {when}",
  partial: "Some sections were unavailable this time.",
  nextSync: "Next automatic sync {when}",
  failure: {
    bad_password: "Your username or password is incorrect.",
    extra_verification: "IAU asked for an extra step. Sign in once at vle.iau.edu.sa, then try again.",
    unreachable: "Blackboard is unreachable right now. Waypoint will try again soon.",
    needs_login: "Your Blackboard session ended. Sign in again to keep syncing.",
    browser_missing: "The sync browser is not installed. Run setup again.",
    extract_failed: "Blackboard answered in an unexpected way. Try again later.",
    interrupted: "The last sync was interrupted. Try again.",
  },
  deadlines: {
    title: "Blackboard deadlines",
    empty: "No upcoming deadlines in your current courses.",
    overdue: "Overdue",
    due: "Due {when}",
    open: "Open in Blackboard",
  },
} as const
```

Create `src/locales/ar/blackboard.ts`:

```ts
import type { CatalogShape } from "@/lib/i18n/core"
import type { blackboard as en } from "../en/blackboard"

export const blackboard: CatalogShape<typeof en> = {
  title: "Blackboard",
  subtitle: "المقررات والمواعيد النهائية والإعلانات والملفات والدرجات من Blackboard الجامعة. للقراءة فقط.",
  username: "اسم المستخدم في الجامعة",
  password: "كلمة المرور",
  remember: "تذكّر بيانات دخولي ليواصل Waypoint المزامنة",
  rememberHint: "تُحفظ مشفّرة على هذا الجهاز فقط، ويمكنك حذفها في أي وقت.",
  rememberUnavailable: "شغّل الإعداد مرة أخرى لتفعيل حفظ بيانات الدخول.",
  sync: "زامن بيانات Blackboard",
  syncNow: "زامن الآن",
  signInAgain: "سجّل الدخول مجددًا",
  forget: "احذف بيانات دخولي",
  reviewNew: "راجع العناصر الجديدة",
  stage: {
    queued: "جارٍ البدء…",
    logging_in: "جارٍ تسجيل الدخول إلى الجامعة…",
    extracting: "جارٍ قراءة مقرراتك…",
    reading_files: "جارٍ قراءة ملفات المقررات…",
    saving: "جارٍ الحفظ…",
  },
  stats: {
    current_courses: "مقررات حالية",
    upcoming_deadlines: "مواعيد قادمة",
    overdue: "متأخرة",
    materials: "مواد",
    files_read: "ملفات مقروءة",
    new_evidence: "عناصر جديدة للمراجعة",
  },
  synced: "تمت المزامنة {when}",
  partial: "بعض الأقسام لم تكن متاحة هذه المرة.",
  nextSync: "المزامنة التلقائية التالية {when}",
  failure: {
    bad_password: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    extra_verification: "طلبت الجامعة خطوة إضافية. سجّل الدخول مرة في vle.iau.edu.sa ثم حاول مجددًا.",
    unreachable: "تعذّر الوصول إلى Blackboard حاليًا. سيحاول Waypoint مجددًا قريبًا.",
    needs_login: "انتهت جلسة Blackboard. سجّل الدخول مجددًا لمواصلة المزامنة.",
    browser_missing: "متصفح المزامنة غير مثبّت. شغّل الإعداد مرة أخرى.",
    extract_failed: "ردّ Blackboard بشكل غير متوقع. حاول لاحقًا.",
    interrupted: "توقفت المزامنة الأخيرة. حاول مجددًا.",
  },
  deadlines: {
    title: "مواعيد Blackboard",
    empty: "لا توجد مواعيد قادمة في مقرراتك الحالية.",
    overdue: "متأخر",
    due: "الموعد {when}",
    open: "افتح في Blackboard",
  },
}
```

Register them:
- In `src/locales/en/index.ts`, add `import { blackboard } from "./blackboard"`, and add `blackboard` to the `en` object.
- In `src/locales/ar/index.ts`, add `import { blackboard } from "./blackboard"`, and add `blackboard` to the `ar` object.

In `src/locales/en/core.ts` `sourceKinds`, add `blackboard: "Blackboard",`. In `src/locales/ar/core.ts` `sourceKinds`, add `blackboard: "Blackboard",`.

In `src/locales/en/agent.ts` line 62, change the text to `"Your Blackboard courses, deadlines, announcements and files."`. In `src/locales/ar/agent.ts` line 64, change it to `"مقرراتك ومواعيدك وإعلاناتك وملفاتك في Blackboard."`.

- [ ] **Step 3: Write `BlackboardSyncCard.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react"
import { AlertCircle, GraduationCap, LoaderCircle, RotateCcw } from "lucide-react"
import { api, getCurrentStudentId, type BlackboardSyncStatus } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

const RUNNING = new Set(["queued", "logging_in", "extracting", "reading_files", "saving"])
const STATS = ["current_courses", "upcoming_deadlines", "overdue", "materials", "files_read", "new_evidence"] as const

/** My Data > Blackboard: one sign-in, then background sync. The password is sent once and never shown again. */
export function BlackboardSyncCard({ onReview }: { onReview?: () => void }) {
  const { t, fmt } = useI18n()
  const studentId = getCurrentStudentId()
  const [status, setStatus] = useState<BlackboardSyncStatus | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const path = `/api/students/${studentId}/blackboard`

  const load = useCallback(async () => {
    try { setStatus(await api<BlackboardSyncStatus>(`${path}/sync`)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [path])

  useEffect(() => { void load() }, [load])
  const running = status ? RUNNING.has(status.status) : false
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [running, load])

  async function start(withLogin: boolean) {
    setBusy(true)
    setError(null)
    try {
      const body = withLogin ? JSON.stringify({ username: username.trim(), password, remember: remember && !!status?.can_remember }) : undefined
      setStatus(await api<BlackboardSyncStatus>(`${path}/sync`, { method: "POST", body }))
      setPassword("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function forget() {
    setBusy(true)
    try { await api(`${path}/connection`, { method: "DELETE" }); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  const needsLogin = !status?.connected || (status.status === "failed" && ["bad_password", "needs_login"].includes(status.failure_reason ?? "") && !status.has_saved_login)
  const summary = status?.summary ?? {}

  return (
    <section aria-label={t("blackboard.title")} className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><GraduationCap className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("blackboard.title")}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t("blackboard.subtitle")}</p>
        </div>
      </div>

      {status?.status === "failed" && status.failure_reason ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t(`blackboard.failure.${status.failure_reason}`)}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-4 text-[13px] text-destructive">{error}</p> : null}

      {running && status ? (
        <p className="mt-4 flex items-center gap-2 text-sm" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {t(`blackboard.stage.${status.status as "queued" | "logging_in" | "extracting" | "reading_files" | "saving"}`)}
          {status.stage_detail ? <span className="text-muted-foreground">· <bdi>{status.stage_detail}</bdi></span> : null}
        </p>
      ) : needsLogin ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (username.trim() && password && !busy) void start(true) }}>
          <label className="grid gap-1 text-[13px] font-medium">{t("blackboard.username")}
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" dir="ltr" className="h-11 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="grid gap-1 text-[13px] font-medium">{t("blackboard.password")}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" className="h-11 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          {status?.can_remember === false ? (
            <p className="text-[12px] text-muted-foreground sm:col-span-2">{t("blackboard.rememberUnavailable")}</p>
          ) : (
            <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-4" />
              <span>{t("blackboard.remember")}<span className="block text-[12px] text-muted-foreground">{t("blackboard.rememberHint")}</span></span>
            </label>
          )}
          <button type="submit" disabled={!username.trim() || !password || busy} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 sm:col-span-2 sm:justify-self-start">
            {t(status?.connected ? "blackboard.signInAgain" : "blackboard.sync")}
          </button>
        </form>
      ) : status ? (
        <div className="mt-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STATS.map((key) => (
              <div key={key} className="rounded-2xl bg-muted/50 px-3 py-2">
                <dt className="text-[12px] text-muted-foreground">{t(`blackboard.stats.${key}`)}</dt>
                <dd className="text-xl font-semibold tabular-nums">{fmt.number(summary[key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-muted-foreground">
            {status.last_synced_at ? t("blackboard.synced", { when: fmt.relative(status.last_synced_at) }) : null}
            {status.next_sync_at ? ` · ${t("blackboard.nextSync", { when: fmt.relative(status.next_sync_at) })}` : null}
          </p>
          {summary.partial ? <p className="mt-1 text-[12px] text-muted-foreground">{t("blackboard.partial")}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void start(false)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"><RotateCcw className="size-4" aria-hidden="true" />{t("blackboard.syncNow")}</button>
            {onReview && (summary.new_evidence ?? 0) > 0 ? <button type="button" onClick={onReview} className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-muted">{t("blackboard.reviewNew")}</button> : null}
            <button type="button" onClick={() => void forget()} disabled={busy} className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">{t("blackboard.forget")}</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
```

If `fmt.relative` doesn't accept an ISO string, wrap it: `fmt.relative(new Date(value))`. Check `createFormatters` in `src/lib/i18n/core.ts` (`relative: (value: Date | string | number, ...)`; strings are accepted).

- [ ] **Step 4: Render it in `SourcesStep.tsx`**

Add `import { BlackboardSyncCard } from "@/components/onboarding/BlackboardSyncCard"` next to the `OutlookView` import. Directly before `<details className="mt-6 rounded-2xl border border-border p-4">` (the Outlook block), add:

```tsx
        <BlackboardSyncCard onReview={onNext} />
```

Before inserting, confirm `SourcesStep`'s props include `onNext` (MyDataView passes `onNext={() => setStep("review")}`). If the prop has a different name, use whatever moves to the review step.

- [ ] **Step 5: Write `BlackboardDeadlines.tsx` and render it in Today**

```tsx
import { useEffect, useState } from "react"
import { CalendarClock, ExternalLink } from "lucide-react"
import { api, getCurrentStudentId, type BlackboardDeadline } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"

/** Today: the next graded work from Blackboard. Renders nothing until a sync has stored deadlines. */
export function BlackboardDeadlines() {
  const { t, fmt } = useI18n()
  const [items, setItems] = useState<BlackboardDeadline[] | null>(null)

  useEffect(() => {
    let alive = true
    api<{ items: BlackboardDeadline[] }>(`/api/students/${getCurrentStudentId()}/blackboard/deadlines`)
      .then((data) => { if (alive) setItems(data.items) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [])

  if (!items || items.length === 0) return null
  return (
    <section aria-label={t("blackboard.deadlines.title")} className="rounded-3xl border border-border bg-background p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight"><CalendarClock className="size-[18px]" aria-hidden="true" />{t("blackboard.deadlines.title")}</h2>
      <ul className="mt-4 grid gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium"><bdi>{item.title}</bdi></p>
              <p className="truncate text-[12px] text-muted-foreground"><bdi>{item.course}</bdi> · {item.overdue ? <span className="font-semibold text-destructive">{t("blackboard.deadlines.overdue")}</span> : t("blackboard.deadlines.due", { when: fmt.dateTime(item.due_at) })}</p>
            </div>
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" aria-label={t("blackboard.deadlines.open")} className="shrink-0 rounded-full p-2 hover:bg-muted"><ExternalLink className="size-4" aria-hidden="true" /></a> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

In `TodayView.tsx`, add `import { BlackboardDeadlines } from "@/components/dashboard/BlackboardDeadlines"`. Directly before the line `{/* What moved: simple feed, newest first. */}`, add:

```tsx
        <Reveal delay={0.12} className="mt-5">
          <BlackboardDeadlines />
        </Reveal>
```

- [ ] **Step 6: Type-check and build**

Run: `npm run build`

Expected: build succeeds with no TypeScript errors. A `CatalogShape` error means an ar key is missing; add it.

- [ ] **Step 7: Verify in the running app**

Start the app with `preview_start` (`.claude/launch.json`). If it's missing, create configurations for the API (`run.bat` / uvicorn) and Vite (`npm run dev`, port 5173). Open My Data:
- The Blackboard card renders with username and password fields, the remember checkbox and **Sync my Blackboard data**.
- Toggle Arabic: the card is RTL with no missing-key strings, and the input text stays LTR.
- Resize to mobile (375 px): no horizontal scroll.

Then run one live sync with the student's real credentials. The student types them; never type them yourself. Confirm:
- the stages advance;
- the stat tiles show non-zero current courses and upcoming deadlines;
- Today shows the Blackboard deadlines panel;
- `read_network_requests` shows no response body containing the password.

Take a screenshot as proof.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(my-data): Blackboard sync card and Today deadlines panel (en/ar)"
```

---

### Task 12: Threat model, invariants, handoff

**Files:**
- Create: `docs/blackboard-threat-model.md`
- Modify: `AGENTS.md`, `docs/handoff.md`

- [ ] **Step 1: Write `docs/blackboard-threat-model.md`**

Sections, each a few short paragraphs:

1. **What is stored and where.**
   - `blackboard_connections.password_enc` and `session_enc` are Fernet-sealed with `WAYPOINT_TOKEN_ENCRYPTION_KEY`.
   - Attachment bytes stay in memory only.
   - Redacted text is kept in `blackboard_content_items`.
2. **Blast radius.**
   - The IAU password also unlocks the student's IAU Microsoft account (mail, Teams).
   - Anyone with both the SQLite file and `.env` can recover it.
   - It's acceptable only because Waypoint runs on the student's own machine. A hosted deployment must not enable remembered logins.
3. **What the sync can do.**
   - GET only, plus the AD FS form submit.
   - It reads only the student's own data, with their entitlements.
   - Hermes never sees credentials, and gets Blackboard data only through the existing read tools behind the connector switch.
4. **Lockout safety.**
   - A saved password that fails once is wiped, and the loop stops.
   - 3 typed failures wipe everything.
   - Network errors do not count.
5. **The forget path.** `DELETE /api/students/{id}/blackboard/connection`, and the "Forget my login" button.
6. **Untrusted content.**
   - Announcement, content and file text is untrusted data for Hermes.
   - Only course-level records become `suggested` evidence.
7. **Rejected alternatives.**
   - Extension-only: it needs a manual install and click, which fails the seamless requirement.
   - Official REST/3LO: it needs IAU admin registration.
   - Pure HTTP replay of SAML: fragile, and it needs a second extractor.
8. **Owed.**
   - If IAU adds MFA, the sync will fail with `extra_verification`; supporting MFA is a separate design.
   - Hosted multi-user deployments need a different secret store.

- [ ] **Step 2: Add the AGENTS.md invariant**

Under `## Invariants`, after the Coach mail tools bullet, add:

```markdown
- Blackboard sync (`services/api/app/blackboard_sync/`) signs in to IAU with the student's own credentials
  in headless Chromium and runs `BB-Extension/src` (one extractor for the extension and the app). The password
  and session are Fernet-sealed, never returned, logged or given to Hermes; a saved password that fails once is
  wiped. Requests are GET-only except the AD FS form submit. Synced data is `blackboard_live`; only course-level
  records become `suggested` evidence. See `docs/blackboard-threat-model.md`.
```

Under `## Commands`, add:

```markdown
- Extension tests: `node BB-Extension/test/run-tests.js` (regenerate the console snippet with `node BB-Extension/tools/build-console.js`)
```

- [ ] **Step 3: Update `docs/handoff.md`**

Add a short "Blackboard live sync (2026-10-03)" entry covering:
- what shipped;
- the manual live-smoke result from Task 11 Step 7: counts compared with the 2026-10-03 export;
- the known follow-ups (MFA, a hosted secret store, `captureSamples` for debugging new portal shapes).

- [ ] **Step 4: Final verification**

Run:

```bash
node BB-Extension/test/run-tests.js
.venv/Scripts/python -m pytest services/api/tests -q
npm run build
```

Expected: all three pass.

- [ ] **Step 5: Commit**

```bash
git add docs/blackboard-threat-model.md AGENTS.md docs/handoff.md
git commit -m "docs: Blackboard sync threat model, invariant and handoff"
```
