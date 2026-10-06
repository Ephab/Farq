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
global.document = { createElement: () => ({ set innerHTML(v) { this._h = v; }, get textContent() { return (this._h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"); } }) };
global.location = { origin: "https://vle.iau.edu.sa" };

const BAD_PATH_HIT = [];
let FAIL_CHILDREN = false; // simulate a folder whose children listing returns HTTP 500
let FAIL_GLOBAL_CAL = false; // simulate the all-courses calendar sweep failing
const CALLS = [];
const responses = {
  me: { id: "_1_1", userName: "student" },
  memberships: {
    results: [
      { id: "_m1", courseRoleId: "Student", enrollmentDate: "2026-09-01T00:00:00.000Z", course: { id: "_101_1", courseId: "CS101-2026", displayName: "Intro to Computing", availability: { available: "Yes" }, termId: "_t1", modified: "2026-09-10T00:00:00.000Z" } },
      { id: "_m2", courseRoleId: "Student", enrollmentDate: "2021-09-01T00:00:00.000Z", course: { id: "_102_1", courseId: "HIST101-2021", displayName: "Old History", availability: { available: "No" }, modified: "2021-12-01T00:00:00.000Z" } }
    ], paging: {}
  },
  terms: { results: [{ id: "_t1", name: "Fall 2026", availability: { duration: { start: "2026-08-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" } } }], paging: {} },
  roster101: { results: [{ courseRoleId: "Instructor", userId: "_9_1", user: { name: { given: "A", family: "Prof" }, contact: { email: "a@iau.edu.sa" } } }], paging: {} },
  roster102: { results: [], paging: {} },
  contents101: { results: [{ id: "_c1", title: "Week 1 slides", body: "<p>Hello</p>", contentHandler: { id: "resource/x-bb-document" }, hasChildren: false, created: "2026-09-02T00:00:00.000Z", modified: "2026-09-03T00:00:00.000Z", availability: { available: "Yes" } }], paging: {} },
  pubContents101: { results: [
    { id: "_f1", title: "Week 1", description: "x".repeat(300), contentHandler: { id: "resource/x-bb-folder" }, hasChildren: true, created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", availability: { available: "Yes" } },
    { id: "_c1", title: "Week 1 slides", body: "<p>Hello &amp; welcome</p>", contentHandler: { id: "resource/x-bb-document" }, hasChildren: false, created: "2026-09-02T00:00:00.000Z", modified: "2026-09-03T00:00:00.000Z", availability: { available: "Yes" } }
  ], paging: {} },
  pubChildrenF1: { results: [
    { id: "_file1", title: "Course Syllabus.pdf", body: "https://vle.iau.edu.sa/courses/1/X/content/_file1/embedded/", contentHandler: { id: "resource/x-bb-file", file: { fileName: "Course Syllabus.pdf", mimeType: "application/pdf" } }, hasChildren: false, created: "2026-09-01T00:00:00.000Z", modified: "2026-09-01T00:00:00.000Z" }
  ], paging: {} },
  attachmentsFile1: { results: [{ id: "_att9", fileName: "Course Syllabus.pdf", mimeType: "application/pdf" }] },
  categories101: { results: [{ id: "_cat1", title: "Quizzes" }] },
  contents102: { results: [], paging: {} },
  ann101: {
    results: [{
      id: "_a1", title: "Welcome",
      body: { rawText: "<p>Welcome <b>all</b></p>", displayText: "<p>Welcome <b>all</b></p>" },
      created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", createdBy: { userName: "prof.a", id: "_9_1" }
    }], paging: {}
  },
  ann102: { results: [], paging: {} },
  cols101: {
    results: [
      { id: "_col1", name: "Assignment 1", description: "<p>Do it</p>", grading: { due: "2026-02-10T20:59:00.000Z" }, score: { possible: 10 }, contentId: "_c1", gradebookCategoryId: "Assignment" },
      { id: "_col2", name: "Quiz 1", grading: { due: "2026-03-01T20:59:00.000Z" }, score: { possible: 5 }, gradebookCategoryId: "_cat1" },
      { id: "_col3", name: "Attendance Week 1", score: { possible: 1 }, gradebookCategoryId: "Attendance" },
      { id: "_col4", name: "Project report", grading: { due: "2099-01-15T20:59:00.000Z" }, score: { possible: 20 }, gradebookCategoryId: "Assignment" },
      { id: "_total", name: "Total", externalGrade: true, score: { possible: 100 } }
    ], paging: {}
  },
  cols102: { results: [{ id: "_total2", name: "Total", externalGrade: true, score: { possible: 50 } }], paging: {} },
  userGrades101: { results: [{ columnId: "_col1", userId: "_1_1", status: "Graded", score: 9, displayGrade: { score: 9, possible: 10, text: "9/10" }, feedback: "Good work", modified: "2026-02-12T00:00:00.000Z" },
    { columnId: "_total", userId: "_1_1", status: "Graded", score: 88, displayGrade: { score: 88, possible: 100, text: "B+" } }] },
  attemptsCol1: { results: [{ id: "_att1", status: "Graded", created: "2026-02-09T00:00:00.000Z", modified: "2026-02-10T20:00:00.000Z" }] },
  cal101: { results: [{ id: "_cal1", title: "Assignment 1", start: "2026-02-10T20:59:00.000Z", end: "2026-02-10T20:59:00.000Z", type: "GradebookColumn", calendarId: "_101_1", calendarName: "Intro to Computing", dynamicCalendarItemProps: { id: "_col1" } }, { id: "_cal2", title: "Lab session", start: "2026-10-05T08:00:00.000Z", end: "2026-10-05T10:00:00.000Z", type: "Course", calendarId: "_101_1", calendarName: "Intro to Computing" }] },
  cal102: { results: [] },
  calGlobal: null // set below: the global sweep returns every course's items
};

responses.calGlobal = { results: [...responses.cal101.results] };

global.fetch = async (url) => {
  const u = new URL(url);
  const p = u.pathname;
  CALLS.push(p + u.search);
  if (p.includes("/users/_1_1/grades")) BAD_PATH_HIT.push(p); // the known-404 path must never be called
  const ok = (v) => ({ ok: true, headers: { get: () => "application/json" }, json: async () => v });
  const miss = (status) => ({ ok: false, status, headers: { get: () => "" }, json: async () => ({}) });
  if (p === "/learn/api/v1/users/me") return ok(responses.me);
  if (p === "/learn/api/v1/users/me/memberships") return ok(responses.memberships);
  if (p === "/learn/api/v1/terms") return ok(responses.terms);
  if (p === "/learn/api/v1/courses/_101_1/users") return miss(404);
  if (p === "/learn/api/v1/courses/_102_1/users") return miss(404);
  if (p === "/learn/api/v1/courses/_101_1/contents") return ok(responses.contents101);
  if (p === "/learn/api/v1/courses/_102_1/contents") return ok(responses.contents102);
  if (p === "/learn/api/v1/courses/_101_1/announcements") return ok(responses.ann101);
  if (p === "/learn/api/v1/courses/_102_1/announcements") return miss(403);
  if (p === "/learn/api/public/v2/courses/_101_1/gradebook/columns") return ok(responses.cols101);
  if (p === "/learn/api/public/v2/courses/_102_1/gradebook/columns") return ok(responses.cols102);
  if (p === "/learn/api/public/v1/courses/_101_1/gradebook/users/_1_1") return ok(responses.userGrades101);
  if (p === "/learn/api/public/v1/courses/_102_1/gradebook/users/_1_1") return miss(404);
  if (p === "/learn/api/public/v1/courses/_101_1/gradebook/columns/_col1/users/_1_1") return ok(responses.userGrades101.results[0]);
  if (p === "/learn/api/public/v1/courses/_102_1/gradebook/columns/_total2/users/_1_1") return ok({ columnId: "_total2", userId: "_1_1", status: "Graded", score: 40, displayGrade: { score: 40, possible: 50, text: "A-" } });
  if (p === "/learn/api/public/v2/courses/_101_1/gradebook/columns/_col1/users/_1_1/attempts") return ok(responses.attemptsCol1);
  if (p === "/learn/api/public/v1/calendars/items") {
    const span = Date.parse(u.searchParams.get("until")) - Date.parse(u.searchParams.get("since"));
    if (!(span > 0) || span > 112 * 864e5) return miss(400); // real Blackboard behaviour
    if (u.searchParams.get("courseId") === "_101_1") return ok(responses.cal101);
    if (u.searchParams.get("courseId") === "_102_1") return ok(responses.cal102);
    return FAIL_GLOBAL_CAL ? miss(500) : ok(responses.calGlobal);
  }
  if (p === "/learn/api/public/v1/courses/_101_1/users") return miss(403); // students may not list members
  if (p === "/learn/api/v1/courses/_101_1") return ok({ id: "_101_1", instructorsMembership: [{ user: { givenName: "A", familyName: "Prof", emailAddress: "a@iau.edu.sa", id: "_9_1" } }] });
  if (p === "/learn/api/v1/courses/_102_1") return miss(403); // closed course
  if (p === "/learn/api/public/v1/courses/_101_1/contents") return ok(responses.pubContents101);
  if (p === "/learn/api/public/v1/courses/_101_1/contents/_f1/children") return FAIL_CHILDREN ? miss(500) : ok(responses.pubChildrenF1);
  if (p === "/learn/api/public/v1/courses/_101_1/contents/_file1/attachments") return ok(responses.attachmentsFile1);
  if (p === "/learn/api/public/v1/courses/_101_1/contents/_c1/attachments") return ok({ results: [] });
  if (p === "/learn/api/public/v1/courses/_102_1/contents") return miss(403);
  if (p === "/learn/api/public/v1/courses/_101_1/gradebook/categories") return ok(responses.categories101);
  if (p === "/learn/api/public/v1/courses/_102_1/gradebook/categories") return miss(403);
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
  check("instructor source recorded", all.courses.find((c) => c.id === "_101_1").instructor_source === "ultra-course", all.courses[0]);
  check("old roster path no longer called", !all.diagnostics.sources.some((s) => s.endpoint === "GET /learn/api/v1/courses/{id}/users"));
  const srcs = all.diagnostics.sources;
  check("probe misses and 403s are not failures", srcs.some((s) => String(s.status).startsWith("probe_")) && srcs.some((s) => s.status === "forbidden") && !all.diagnostics.failed_sources.some((f) => /probe_|forbidden/.test(f)), all.diagnostics.failed_sources);
  const ann = all.announcements.find((a) => a.announcement_id === "_a1");
  check("announcement body_text is plain text", ann && ann.body_text === "Welcome all", ann && ann.body_text);
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
  check("one global calendar sweep, no per-course sweeps", !all.diagnostics.sources.some((s) => /^calendar:/.test(s.source)) && all.diagnostics.sources.some((s) => s.source === "calendar-global"));
  check("calendar links GradebookColumn item to its assessment", all.assessments.find((a) => a.column_id === "_col1").calendar_id === "_cal1");
  check("every course read in full by default", all.courses.every((c) => c.detail === "full"));
  check("non-assessment calendar event kept", all.events.some((e) => e.source_id === "cal:_cal2" && e.type === "Course"));
  const quiz = all.assessments.find((a) => a.column_id === "_col2");
  check("ungraded past quiz is overdue", quiz && quiz.is_overdue === true && quiz.is_upcoming === false, quiz);
  const report = all.assessments.find((a) => a.column_id === "_col4");
  check("future ungraded item is upcoming", report && report.is_upcoming === true, report);
  check("graded item neither upcoming nor overdue", a1 && !a1.is_upcoming && !a1.is_overdue, a1);
  check("summary counts deadlines", all.summary.upcoming_deadlines >= 1 && all.summary.overdue >= 1, all.summary);
  const c101 = all.courses.find((c) => c.id === "_101_1");
  check("term name attached", c101.term_name === "Fall 2026", c101);
  check("final grade from external column", c101.final_grade && c101.final_grade.text === "B+" && c101.final_grade.percentage === 88, c101.final_grade);
  check("grade summary excludes the total column", c101.grade_summary && c101.grade_summary.graded === 1 && c101.grade_summary.possible === 10, c101.grade_summary);
  const c102 = all.courses.find((c) => c.id === "_102_1");
  check("final grade via per-column fallback when bulk grades 404", c102 && c102.final_grade && c102.final_grade.text === "A-" && c102.final_grade.percentage === 80, c102 && c102.final_grade);
  check("every course has a final_grade key", all.courses.length > 0 && all.courses.every((c) => "final_grade" in c && (c.final_grade === null || typeof c.final_grade === "object")), all.courses.map((c) => c.final_grade));
  check("total column is not an assessment", !all.assessments.some((a) => a.column_id === "_total"));
  const syl = all.content.find((m) => m.content_id === "_file1");
  check("folder children walked with path + parent", syl && syl.parent_id === "_f1" && syl.path === "Week 1 / Course Syllabus.pdf", syl);
  check("content type from public handler", syl && syl.type === "File" && all.content.some((m) => m.type === "Folder"), syl);
  check("embedded URL is not a description", syl && syl.body_text === null && syl.embedded_url && syl.embedded_url.includes("/embedded/"), syl);
  check("attachment has download_url", syl && syl.attachments.length === 1 && syl.attachments[0].download_url === "https://vle.iau.edu.sa/learn/api/public/v1/courses/_101_1/contents/_file1/attachments/_att9/download", syl && syl.attachments);
  const attSrc = all.diagnostics.sources.find((x) => x.source === "attachments:_101_1");
  check("attachments source recorded ok with count", attSrc && attSrc.status === "ok" && attSrc.count === 1 && attSrc.truncated === false && attSrc.listing_errors === 0, attSrc);
  check("content body is plain text", all.content.find((m) => m.content_id === "_c1").body_text === "Hello & welcome");
  check("category title resolves classification", all.assessments.find((a) => a.column_id === "_col2").type === "Quiz" && all.assessments.find((a) => a.column_id === "_col2").gradebook_category === "Quizzes");
  check("legacy aliases present", Array.isArray(all.assignments) && Array.isArray(all.materials));
  check("diagnostics sources recorded", all.diagnostics.sources.length > 5 && all.summary.assessments >= 3, all.summary);

  const cur = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "current" });
  check("scope=current filters to 1 course", cur.courses.length === 1 && cur.courses[0].id === "_101_1", cur.courses.map((c) => c.id));
  check("scope=current drops historical assessments", !cur.assessments.some((a) => a.course_id === "_102_1"));

  const red = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", redact: true });
  check("redact: user id pseudonymized", red.user.id !== "_1_1" && red.user.userName === "REDACTED");
  check("redact: course/column IDs preserved", red.courses.some((c) => c.id === "_101_1") && red.assessments.some((a) => a.column_id === "_col1"));
  check("redact: no raw userName leak", !JSON.stringify(red).includes('"userName":"student"'));
  check("redact: announcement author pseudonymized", !JSON.stringify(red).includes("prof.a") && red.announcements.every((x) => x.author !== "prof.a"));
  const redS = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", redact: true, captureSamples: true });
  check("redact+captureSamples: no prof.a leak", !JSON.stringify(redS).includes("prof.a") && !!redS.diagnostics.samples);

  const dbg = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", captureSamples: true });
  check("captureSamples records raw shapes", dbg.diagnostics.samples && dbg.diagnostics.samples.contents && dbg.diagnostics.samples.contents.id === "_f1", dbg.diagnostics.samples && Object.keys(dbg.diagnostics.samples));
  const sampJson = JSON.stringify(dbg.diagnostics.samples);
  check("samples strip user keys", !sampJson.includes("a@iau.edu.sa") && !sampJson.includes("Prof") && !sampJson.includes('"givenName"'), sampJson.slice(0, 300));
  check("samples truncate strings to 120 chars", typeof dbg.diagnostics.samples.contents.description === "string" && dbg.diagnostics.samples.contents.description.length === 120);
  check("no samples by default", all.diagnostics.samples === undefined);

  check("contents source ok when every folder opened", all.diagnostics.sources.filter((x) => x.source === "contents:_101_1").every((x) => x.status === "ok"));

  FAIL_CHILDREN = true;
  const partial = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", retries: 0 });
  FAIL_CHILDREN = false;
  const contentsSrc = partial.diagnostics.sources.filter((x) => x.source === "contents:_101_1");
  check("children 500 -> exactly one contents:<cid> entry, status partial", contentsSrc.length === 1 && contentsSrc[0].status === "partial" && contentsSrc[0].children_errors === 1, contentsSrc);
  check("partial contents counts as a failed source", partial.summary.failed_sources >= 1 && partial.diagnostics.failed_sources.some((f) => f.startsWith("contents:_101_1: partial")), partial.diagnostics.failed_sources);
  check("children 500 keeps the items it could read", partial.content.some((m) => m.content_id === "_c1") && !partial.content.some((m) => m.content_id === "_file1"));

  FAIL_GLOBAL_CAL = true;
  const calFallback = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", retries: 0 });
  FAIL_GLOBAL_CAL = false;
  check("global calendar failure falls back to per-course sweeps", calFallback.diagnostics.sources.some((s) => s.source === "calendar:_101_1" && s.status === "ok")
    && calFallback.events.some((e) => e.source_id === "cal:_cal1" && e.course === "Intro to Computing"), calFallback.diagnostics.failed_sources);

  CALLS.length = 0;
  const light = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all", summaryOnly: ["_102_1", "_101_1"] });
  const old = light.courses.find((c) => c.id === "_102_1");
  check("summaryOnly: past course reads grades only", old.detail === "summary" && old.final_grade && old.final_grade.text === "A-"
    && !CALLS.some((c) => /courses\/_102_1(\?|\/contents|\/announcements|\/users\?|\/gradebook\/categories)/.test(c)), CALLS.filter((c) => c.includes("_102_1")));
  check("summaryOnly: columns are not reported as a full column read", !light.diagnostics.sources.some((s) => s.source === "columns:_102_1")
    && light.diagnostics.sources.some((s) => s.source === "summary-columns:_102_1"));
  check("summaryOnly never applies to current courses", light.courses.find((c) => c.id === "_101_1").detail === "full"
    && light.content.some((m) => m.course_id === "_101_1"));

  const originalFetch = global.fetch;
  for (let i = 0; i < 85; i++) responses.pubChildrenF1.results.push({ id: `_extra${i}`, title: `Lecture ${i}.pptx`, contentHandler: { id: "resource/x-bb-file" } });
  responses.pubChildrenF1.results.push({ id: "_linked", title: "Linked lecture", body: '<a href="/bbcswebdav/Lecture.pdf">Lecture</a><a href="https://evil.example/bad.pdf">Bad</a>', contentHandler: { id: "resource/x-bb-item" } });
  const embedded = (url, name) => `<a data-bbfile="${JSON.stringify({ resourceUrl: url, linkName: name, mimeType: "application/pdf" }).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" href="${url.replace(/&/g, "&amp;")}"></a>`;
  responses.pubChildrenF1.results.push({ id: "_embedded", title: "ultraDocumentBody", body:
    embedded("https://vle.iau.edu.sa/bbcswebdav/pid-123-dt-content-rid-456_1/xid-456_1?a=1&b=2", "Lecture 1.pdf")
    + embedded("https://evil.example/xid-2", "Lecture 2.pdf")
    + '<a data-bbfile="broken"></a>', contentHandler: { id: "resource/x-bb-document" } });
  global.fetch = async (url, opts) => /\/contents\/_extra\d+\/attachments/.test(url)
    ? { ok: true, headers: { get: () => "application/json" }, json: async () => ({ results: [{ id: "_a", fileName: "Lecture.pptx" }] }) } : originalFetch(url, opts);
  const large = await ex.extractAll({ origin: "https://vle.iau.edu.sa", scope: "all" });
  check("attachment discovery covers files beyond the old 80-item cap", large.content.filter((c) => c.content_id.startsWith("_extra") && c.attachments.length).length === 85);
  const linked = large.content.find((c) => c.content_id === "_linked");
  check("observed same-origin file links discovered; external links excluded", linked.attachments.length === 1 && linked.attachments[0].download_url.endsWith("/bbcswebdav/Lecture.pdf"));
  const ultra = large.content.find((c) => c.content_id === "_embedded");
  check("Ultra embedded files use metadata names with opaque URLs; external and malformed metadata ignored",
    ultra.attachments.length === 1 && ultra.attachments[0].name === "Lecture 1.pdf"
    && ultra.attachments[0].mime === "application/pdf" && ultra.attachments[0].download_url.endsWith("?a=1&b=2"));

  const fail = checks.filter(([, ok]) => !ok);
  if (fail.length) { console.error(`\n${fail.length} failure(s)`); process.exit(1); }
  console.log("\nMock extract OK — all checks passed.");
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
