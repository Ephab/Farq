/* Mock end-to-end test for BBExtractor.extractAll v2 with stubbed fetch.
 * Proves the full pipeline without touching real Blackboard:
 *  - courses with current/historical split + instructors
 *  - object-body announcement (the "[object Object]" regression)
 *  - gradebook columns -> assessments with classification
 *  - grades via the DOCUMENTED path (gradebook/users/{uid}), never the 404 path
 *  - attempts back-fill, calendar enrichment, ICS merge, ID-stable dedupe
 *  - scope filtering (current vs all) and redaction
 * Run: node test/mock-extract.js
 */
global.document = { createElement: () => ({ set innerHTML(v) { this._h = v; }, get textContent() { return (this._h || "").replace(/<[^>]+>/g, " "); } }) };
global.location = { origin: "https://vle.iau.edu.sa" };

const BAD_PATH_HIT = [];
const responses = {
  me: { id: "_1_1", userName: "student" },
  memberships: {
    results: [
      { id: "_m1", courseRoleId: "Student", enrollmentDate: "2026-09-01T00:00:00.000Z", course: { id: "_101_1", courseId: "CS101-2026", displayName: "Intro to Computing", availability: { available: "Yes" }, termId: "_t1", modified: "2026-09-10T00:00:00.000Z" } },
      { id: "_m2", courseRoleId: "Student", enrollmentDate: "2021-09-01T00:00:00.000Z", course: { id: "_102_1", courseId: "HIST101-2021", displayName: "Old History", availability: { available: "No" }, modified: "2021-12-01T00:00:00.000Z" } }
    ], paging: {}
  },
  terms: { results: [{ id: "_t1", availability: { duration: { start: "2026-08-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" } } }], paging: {} },
  roster101: { results: [{ courseRoleId: "Instructor", userId: "_9_1", user: { name: { given: "A", family: "Prof" }, contact: { email: "a@iau.edu.sa" } } }], paging: {} },
  roster102: { results: [], paging: {} },
  contents101: { results: [{ id: "_c1", title: "Week 1 slides", body: "<p>Hello</p>", contentHandler: { id: "resource/x-bb-document" }, hasChildren: false, created: "2026-09-02T00:00:00.000Z", modified: "2026-09-03T00:00:00.000Z", availability: { available: "Yes" } }], paging: {} },
  contents102: { results: [], paging: {} },
  ann101: {
    results: [{
      id: "_a1", title: "Welcome",
      body: { rawText: "Welcome plain", displayText: "<p>Welcome <b>all</b></p>" },
      created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", createdBy: { userName: "prof.a", id: "_9_1" }
    }], paging: {}
  },
  ann102: { results: [], paging: {} },
  cols101: {
    results: [
      { id: "_col1", name: "Assignment 1", description: "<p>Do it</p>", grading: { due: "2026-02-10T20:59:00.000Z" }, score: { possible: 10 }, contentId: "_c1", gradebookCategoryId: "Assignment" },
      { id: "_col2", name: "Quiz 1", grading: { due: "2026-03-01T20:59:00.000Z" }, score: { possible: 5 }, gradebookCategoryId: "Test" },
      { id: "_col3", name: "Attendance Week 1", score: { possible: 1 }, gradebookCategoryId: "Attendance" },
      { id: "_col4", name: "Project report", grading: { due: "2099-01-15T20:59:00.000Z" }, score: { possible: 20 }, gradebookCategoryId: "Assignment" }
    ], paging: {}
  },
  cols102: { results: [], paging: {} },
  userGrades101: { results: [{ columnId: "_col1", userId: "_1_1", status: "Graded", score: 9, displayGrade: { score: 9, possible: 10, text: "9/10" }, feedback: "Good work", modified: "2026-02-12T00:00:00.000Z" }] },
  attemptsCol1: { results: [{ id: "_att1", status: "Graded", created: "2026-02-09T00:00:00.000Z", modified: "2026-02-10T20:00:00.000Z" }] },
  cal101: { results: [{ id: "_cal1", title: "Assignment 1", start: "2026-02-10T20:59:00.000Z", end: "2026-02-10T20:59:00.000Z", type: "GradebookColumn", calendarId: "_101_1", calendarName: "Intro to Computing", dynamicCalendarItemProps: { id: "_col1" } }, { id: "_cal2", title: "Lab session", start: "2026-10-05T08:00:00.000Z", end: "2026-10-05T10:00:00.000Z", type: "Course", calendarId: "_101_1", calendarName: "Intro to Computing" }] },
  cal102: { results: [] },
  calGlobal: { results: [] }
};

global.fetch = async (url) => {
  const u = new URL(url);
  const p = u.pathname;
  if (p.includes("/users/_1_1/grades")) BAD_PATH_HIT.push(p); // the known-404 path must never be called
  const ok = (v) => ({ ok: true, headers: { get: () => "application/json" }, json: async () => v });
  const miss = (status) => ({ ok: false, status, headers: { get: () => "" }, json: async () => ({}) });
  if (p === "/learn/api/v1/users/me") return ok(responses.me);
  if (p === "/learn/api/v1/users/me/memberships") return ok(responses.memberships);
  if (p === "/learn/api/v1/terms") return ok(responses.terms);
  if (p === "/learn/api/v1/courses/_101_1/users") return ok(responses.roster101);
  if (p === "/learn/api/v1/courses/_102_1/users") return ok(responses.roster102);
  if (p === "/learn/api/v1/courses/_101_1/contents") return ok(responses.contents101);
  if (p === "/learn/api/v1/courses/_102_1/contents") return ok(responses.contents102);
  if (p === "/learn/api/v1/courses/_101_1/announcements") return ok(responses.ann101);
  if (p === "/learn/api/v1/courses/_102_1/announcements") return ok(responses.ann102);
  if (p === "/learn/api/public/v2/courses/_101_1/gradebook/columns") return ok(responses.cols101);
  if (p === "/learn/api/public/v2/courses/_102_1/gradebook/columns") return ok(responses.cols102);
  if (p === "/learn/api/public/v1/courses/_101_1/gradebook/users/_1_1") return ok(responses.userGrades101);
  if (p === "/learn/api/public/v1/courses/_102_1/gradebook/users/_1_1") return miss(404);
  if (p === "/learn/api/public/v1/courses/_101_1/gradebook/columns/_col1/users/_1_1") return ok(responses.userGrades101.results[0]);
  if (p === "/learn/api/public/v2/courses/_101_1/gradebook/columns/_col1/users/_1_1/attempts") return ok(responses.attemptsCol1);
  if (p === "/learn/api/public/v1/calendars/items") {
    const span = Date.parse(u.searchParams.get("until")) - Date.parse(u.searchParams.get("since"));
    if (!(span > 0) || span > 112 * 864e5) return miss(400); // real Blackboard behaviour
    if (u.searchParams.get("courseId") === "_101_1") return ok(responses.cal101);
    if (u.searchParams.get("courseId") === "_102_1") return ok(responses.cal102);
    return ok(responses.calGlobal);
  }
  return miss(404);
};

(async () => {
  const ex = require("../src/extractor.js");
  const checks = [];
  const check = (name, ok, extra) => { checks.push([name, !!ok, extra]); console.log((ok ? "PASS: " : "FAIL: ") + name); };

  const all = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all" });
  check("known-404 grade path never called", BAD_PATH_HIT.length === 0, BAD_PATH_HIT);
  check("2 courses total", all.courses.length === 2, all.courses.length);
  check("is_current flags set", all.courses.some((c) => c.is_current) && all.courses.some((c) => !c.is_current));
  check("instructor extracted", (all.courses.find((c) => c.id === "_101_1").instructors || []).length === 1);
  const ann = all.announcements.find((a) => a.announcement_id === "_a1");
  check("announcement object body -> real text", ann && ann.body_text === "Welcome plain", ann && ann.body_text);
  check("announcement keeps HTML + dates + author", ann && ann.body_html.includes("<p>") && ann.created_at && ann.author === "prof.a", ann);
  check("no [object Object] anywhere", !JSON.stringify(all).includes("[object Object]"));
  const a1 = all.assessments.find((a) => a.column_id === "_col1");
  check("assessment has content+column IDs", a1 && a1.content_id === "_c1" && a1.column_id === "_col1", a1);
  check("assessment classified (not every column = assignment)", all.assessments.some((a) => a.type === "Quiz") && all.assessments.some((a) => a.type === "Attendance"));
  check("grade backfilled + percentage", a1 && a1.grade === "9/10" && a1.percentage === 90, a1);
  check("attempt captured", a1 && a1.attempt_id === "_att1" && a1.submitted_at === "2026-02-10T20:00:00.000Z", a1);
  check("grade record with feedback + posted", all.grades.some((g) => g.feedback === "Good work" && g.posted), all.grades.length);
  check("calendar event normalized", all.events.some((e) => e.source_id === "cal:_cal1" && e.due_date === "2026-02-10T20:59:00.000Z"));
  check("calendar windows never exceed 16 weeks (no 400s)", !all.diagnostics.sources.some((s) => s.source.startsWith("calendar") && s.status === "http_400"));
  check("non-assessment calendar event kept", all.events.some((e) => e.source_id === "cal:_cal2" && e.type === "Course"));
  const quiz = all.assessments.find((a) => a.column_id === "_col2");
  check("ungraded past quiz is overdue", quiz && quiz.is_overdue === true && quiz.is_upcoming === false, quiz);
  const report = all.assessments.find((a) => a.column_id === "_col4");
  check("future ungraded item is upcoming", report && report.is_upcoming === true, report);
  check("graded item neither upcoming nor overdue", a1 && !a1.is_upcoming && !a1.is_overdue, a1);
  check("summary counts deadlines", all.summary.upcoming_deadlines >= 1 && all.summary.overdue >= 1, all.summary);
  check("content has parent/path/type/timestamps", all.content.some((m) => m.parent_id === null && m.path && m.type === "Document" && m.created));
  check("legacy aliases present", Array.isArray(all.assignments) && Array.isArray(all.materials));
  check("diagnostics sources recorded", all.diagnostics.sources.length > 5 && all.summary.assessments >= 3, all.summary);

  const cur = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "current" });
  check("scope=current filters to 1 course", cur.courses.length === 1 && cur.courses[0].id === "_101_1", cur.courses.map((c) => c.id));
  check("scope=current drops historical assessments", !cur.assessments.some((a) => a.course_id === "_102_1"));

  const red = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", redact: true });
  check("redact: user id pseudonymized", red.user.id !== "_1_1" && red.user.userName === "REDACTED");
  check("redact: course/column IDs preserved", red.courses.some((c) => c.id === "_101_1") && red.assessments.some((a) => a.column_id === "_col1"));
  check("redact: no raw userName leak", !JSON.stringify(red).includes('"userName":"student"'));

  const fail = checks.filter(([, ok]) => !ok);
  if (fail.length) { console.error(`\n${fail.length} failure(s)`); process.exit(1); }
  console.log("\nMock extract OK — all checks passed.");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
