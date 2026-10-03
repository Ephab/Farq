/* Unit tests for BBUtils + BBModel + ICS. Fixtures only — no live account.
 * Run: node test/unit-tests.js
 */
const U = require("../src/bb-utils.js");
const M = require("../src/bb-model.js");
const ics = require("../src/ics.js");

let failures = 0;
function assert(cond, msg, extra) {
  if (!cond) { console.error("FAIL:", msg, extra != null ? JSON.stringify(extra).slice(0, 300) : ""); failures++; }
  else console.log("PASS:", msg);
}

async function main() {
  // ---- announcement rich-text (the "[object Object]" bug) ----
  {
    const fromString = U.extractRichText("<p>Hi <b>there</b></p>");
    assert(typeof fromString.text === "string" && fromString.text.includes("Hi"), "rich text: string passes through");
    const fromObj = U.extractRichText({ rawText: "Hello plain", displayText: "<p>Hello</p>" });
    assert(fromObj.text === "Hello plain", "rich text: prefers rawText over markup", fromObj);
    assert(fromObj.html === "<p>Hello</p>", "rich text: still captures markup as html", fromObj);
    const nested = U.extractRichText({ body: { message: "Nested hello" } });
    assert(nested.text === "Nested hello", "rich text: recurses into nested objects", nested);
    const weird = U.extractRichText({ foo: 1, bar: { baz: 2 } });
    assert(weird.text === null, "rich text: object with no strings -> null (never [object Object])", weird);
    assert(U.extractRichText({ a: 1 }).text !== "[object Object]", "rich text: never stringifies a bare object");
    assert(U.extractRichText(null).text === null, "rich text: null -> null");
    assert(U.extractRichText(["", { text: "from array" }]).text === "from array", "rich text: arrays scanned");
  }

  // ---- HTML -> text ----
  {
    assert(U.htmlToText("<p>Hello <b>World</b></p>") === "Hello World", "htmlToText strips tags");
    assert(U.htmlToText(null) === null, "htmlToText null -> null");
    assert(U.htmlToText({ rawText: "Obj text" }) === "Obj text", "htmlToText accepts rich-text objects");
    assert(U.htmlToText("<p>  a   b\nc </p>") === "a b c", "htmlToText collapses whitespace");
  }

  // ---- timestamp normalization ----
  {
    assert(U.normalizeTimestamp("2026-02-10T20:59:00.000Z") === "2026-02-10T20:59:00.000Z", "timestamp: ISO Z kept");
    assert(U.normalizeTimestamp("20260210T205900Z") === "2026-02-10T20:59:00.000Z", "timestamp: ICS basic -> ISO");
    assert(U.normalizeTimestamp("20260210") === "2026-02-10T00:00:00.000Z", "timestamp: ICS DATE -> midnight");
    assert(U.normalizeTimestamp("2026-02-10T23:59:00+03:00") === "2026-02-10T20:59:00.000Z", "timestamp: +03:00 converted to UTC (instant preserved)");
    assert(U.normalizeTimestamp("garbage!!") === null, "timestamp: garbage -> null");
    assert(U.normalizeTimestamp(null) === null, "timestamp: null -> null");
    assert(U.normalizeTimestamp(0) !== null, "timestamp: epoch number parses");
  }

  // ---- ICS parsing ----
  {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:evt-1@x",
      "DTSTART:20260301T080000Z",
      "DTEND:20260301T090000Z",
      "SUMMARY:MATH201: Midterm",
      "DESCRIPTION:Room 101\\, Building A",
      "END:VEVENT",
      "END:VCALENDAR", ""
    ].join("\r\n");
    const ev = ics.parseICS(text);
    assert(ev.length === 1 && ev[0].start === "2026-03-01T08:00:00.000Z", "ICS: parses folded CRLF event");
    assert(ev[0].description === "Room 101, Building A", "ICS: unescapes commas", ev[0]);
    const mapped = ics.toExtractorEvents(ev);
    assert(mapped[0].source_id === "ics:evt-1@x", "ICS: source_id namespaced");
  }

  // ---- assessment classification ----
  {
    assert(M.classifyAssessment({ column: { gradebookCategoryId: "Attendance", name: "Attendance Week 1" } }) === "Attendance", "classify: attendance");
    assert(M.classifyAssessment({ column: { name: "Midterm Exam" } }) === "Exam", "classify: exam by title");
    assert(M.classifyAssessment({ column: { name: "Quiz 3" } }) === "Quiz", "classify: quiz by title");
    assert(M.classifyAssessment({ column: { name: "Homework 1" } }) === "Assignment", "classify: assignment by title");
    assert(M.classifyAssessment({ column: { name: "Mystery column" } }) === "Other", "classify: unknown -> Other (not guessed)");
    assert(M.classifyAssessment({ content: { contentHandler: { id: "resource/x-bb-assignment" } } }) === "Assignment", "classify: handler assignment");
  }

  // ---- current-course filtering (structured signals, not name format) ----
  {
    const now = new Date("2026-09-28T00:00:00Z").getTime();
    const cur = M.isCurrentCourse(
      { availability: { available: "Yes" }, termId: "_t1" },
      { enrollmentDate: "2026-09-01T00:00:00.000Z" },
      new Map([["_t1", { start: "2026-08-01T00:00:00.000Z", end: "2026-12-31T00:00:00.000Z" }]]),
      now);
    assert(cur.current === true, "current filter: available + current term + recent enrollment", cur);
    const old = M.isCurrentCourse(
      { availability: { available: "No" }, courseId: "CS101-2021" },
      { enrollmentDate: "2021-09-01T00:00:00.000Z" },
      new Map(), now);
    assert(old.current === false, "current filter: unavailable + old enrollment -> historical", old);
    // Name alone must not flip an unavailable course to current.
    const nameTrap = M.isCurrentCourse(
      { availability: { available: "No" }, courseId: "CS101-2026", displayName: "2026 Course" },
      { enrollmentDate: "2021-01-01T00:00:00.000Z" },
      new Map(), now);
    assert(nameTrap.current === false, "current filter: name year hint alone cannot override unavailable", nameTrap);
  }

  // ---- assessment dedupe: shared IDs merge; similar titles do NOT ----
  {
    const a = { course_id: "_1", title: "Assignment 1", column_id: "_col1", content_id: null, source_id: "_col1", due_date: "2026-01-01T00:00:00.000Z" };
    const b = { course_id: "_1", title: "Assignment 1 (content copy)", column_id: "_col1", content_id: "_c1", source_id: "_c1", description: " richer body " };
    const c = { course_id: "_1", title: "Assignment 1", column_id: "_col9", content_id: null, source_id: "_col9" };
    const merged = M.mergeAssessments([a, b, c]);
    assert(merged.length === 2, "dedupe: shared column_id merges; different column stays separate", merged.map((x) => x.column_id));
    const ab = merged.find((x) => (x.merged_ids && x.merged_ids.column_ids.includes("_col1")) || x.column_id === "_col1");
    assert(ab && ab.content_id === "_c1" && ab.description.trim() === "richer body", "dedupe: merged record carries content_id + best description");
  }

  // ---- redaction ----
  {
    const data = {
      user: { id: "_1_1", userName: "s12345", email: "s@iau.edu.sa" },
      courses: [{ id: "_101_1", name: "Intro", instructors: [{ name: "Prof", email: "p@iau.edu.sa", userId: "_9_1" }] }],
      assessments: [{ column_id: "_col1", title: "A1" }],
      announcements: [], grades: [],
      diagnostics: { userId: "_1_1", userName: "s12345" }
    };
    const r = M.redactExport(data);
    assert(r.user.userName === "REDACTED" && r.user.id !== "_1_1", "redact: user id + username pseudonymized");
    assert(r.courses[0].id === "_101_1", "redact: course/content/assessment IDs preserved");
    assert(r.assessments[0].column_id === "_col1", "redact: column IDs preserved");
    assert(!r.diagnostics.userId && !r.diagnostics.userName, "redact: diagnostics user keys removed");
    assert(r.courses[0].instructors[0].email === "REDACTED", "redact: instructor email removed");
    const d2 = {
      user: { id: "_1_1", userName: "s12345" }, courses: [], assessments: [], grades: [],
      announcements: [{ id: "_a1", author: "prof.a" }, { id: "_a2", author: "prof.a" }, { id: "_a3", author: "prof.b" }],
      content: [{ id: "_c1", userId: "_7_1", email: "x@iau.edu.sa", author: "prof.a" }],
      materials: [{ id: "_c1", userId: "_7_1", email: "x@iau.edu.sa" }],
      events: [{ id: "e1", email: "x@iau.edu.sa", createdById: "_7_1" }],
      assignments: [{ id: "as1", userId: "_7_1", email: "x@iau.edu.sa" }],
      diagnostics: { samples: { contents: { userId: "_7_1", email: "x@iau.edu.sa", author: "prof.a" } } }
    };
    const r2 = M.redactExport(d2);
    const j2 = JSON.stringify(r2);
    assert(!j2.includes("prof.a") && !j2.includes("prof.b"), "redact: author strings pseudonymized everywhere", j2);
    assert(r2.announcements[0].author === r2.announcements[1].author && r2.announcements[0].author !== r2.announcements[2].author, "redact: same author -> same token, different -> different");
    assert(!j2.includes("x@iau.edu.sa") && !j2.includes("_7_1"), "redact: content/materials/events/assignments/samples walked", j2);
  }

  // ---- malformed / missing fields never throw ----
  {
    assert(U.extractRichText(undefined).text === null, "malformed: undefined rich text");
    assert(U.htmlToText(42) === "42", "malformed: numeric html input stringified safely");
    assert(U.normalizeTimestamp({}) === null, "malformed: object timestamp -> null");
    assert(M.classifyAssessment({}) === "Other", "malformed: empty classification input -> Other");
    assert(M.mergeAssessments([{ title: "no ids at all" }]).length === 1, "malformed: ID-less record kept, not dropped");
  }

  // ---- failed request handling: transient retried, permanent not, errors sanitized ----
  {
    let n = 0;
    global.fetch = async () => {
      n++;
      if (n === 1) return { ok: false, status: 503, headers: { get: () => "" }, json: async () => ({}) };
      return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ ok: true }) };
    };
    const r = await U.getJson("https://x.test", "/flaky", { timeoutMs: 3000, retries: 2 });
    assert(r.ok === true && n === 2, "retry: 503 retried once then succeeds", { n });
    global.fetch = async () => ({ ok: false, status: 404, headers: { get: () => "" }, json: async () => ({}) });
    let threw = false;
    try { await U.getJson("https://x.test", "/missing", { timeoutMs: 3000, retries: 3 }); }
    catch (e) { threw = e.status === 404; }
    assert(threw, "retry: 404 is permanent (no endless retry)");
    const dirty = U.sanitizeError(new Error("GET x JSESSIONID=ABC123 Cookie: BbRouter=zzz token=abc password=hunter2"));
    assert(!/ABC123|hunter2|zzz/.test(dirty), "sanitize: credential values stripped from errors", dirty);
    delete global.fetch;
  }

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
    assert(f({ due_date: "2026-10-10T00:00:00.000Z", submission_status: "InProgress" }).is_upcoming === true, "deadline: InProgress (unsubmitted draft) status is still upcoming");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", submission_status: "in_progress" }).is_overdue === true, "deadline: in_progress status is still overdue");
    assert(f({ due_date: "2026-10-10T00:00:00.000Z", attempts: [{ id: "x", status: "InProgress" }] }).is_upcoming === true, "deadline: in-progress attempt is still upcoming");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", attempts: [{ status: "NotAttempted" }, { status: "Abandoned" }] }).is_overdue === true, "deadline: NotAttempted/Abandoned attempts are still overdue");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", attempts: [{ status: "NeedsGrading" }] }).is_overdue === false, "deadline: NeedsGrading attempt counts as done");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", attempts: [{ status: "completed" }] }).is_overdue === false, "deadline: Completed attempt counts as done (case-insensitive)");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", grade: "-" }).is_overdue === true, "deadline: placeholder grade '-' is still overdue");
    assert(f({ due_date: "2026-10-10T00:00:00.000Z", grade: " - " }).is_upcoming === true, "deadline: placeholder grade ' - ' is still upcoming");
    assert(f({ due_date: "2026-09-01T00:00:00.000Z", grade: 0 }).is_overdue === false, "deadline: numeric grade 0 counts as graded");
  }

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
    const roles = M.instructorsFrom({ results: [
      { userId: "_1_1", courseRoleId: "Facilitator", user: { name: { given: "F", family: "X" } } },
      { userId: "_2_1", courseRoleId: "Guest", user: { name: { given: "G", family: "Y" } } },
      { userId: "_3_1", courseRoleId: "TA", user: { name: { given: "T", family: "Z" } } }
    ] });
    assert(roles.length === 1 && roles[0].userId === "_3_1", "instructors: Facilitator/Guest excluded, TA kept", roles);
    assert(M.instructorsFrom(null).length === 0 && M.instructorsFrom({}).length === 0, "instructors: empty input -> []");
  }

  // ---- htmlToText keeps paragraph breaks and decodes entities ----
  {
    const t = U.htmlToText("<h5>QUIZ 1</h5><p>Topics:&nbsp;Backprop &amp; GD</p><ul><li>One</li><li>Two</li></ul>");
    assert(t === "QUIZ 1\nTopics: Backprop & GD\nOne\nTwo", "htmlToText: block breaks + entities", t);
  }

  // ---- htmlToText prefers DOMParser (inert document) over innerHTML on a live element ----
  {
    const parsed = [];
    let created = 0;
    global.DOMParser = class {
      parseFromString(markup, type) {
        parsed.push(type);
        return { body: { textContent: markup.replace(/<[^>]+>/g, " ") } };
      }
    };
    global.document = { createElement: () => { created++; return {}; } };
    const t = U.htmlToText("<p>Hi <img src=\"https://x.test/a.png\">there</p>");
    assert(t === "Hi there" && parsed[0] === "text/html" && created === 0, "htmlToText: uses DOMParser, never innerHTML, when available", { t, parsed, created });
    delete global.DOMParser;
    delete global.document;
  }

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

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log("\nAll unit tests passed.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
