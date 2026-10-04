/* BB domain model: assessment classification, current-course detection,
 * ID-stable dedupe/merge, and privacy redaction. Pure functions (no fetch/DOM).
 */
(function (global) {
  "use strict";

  function normKey(...parts) {
    return parts.map((p) => (p == null ? "" : String(p).trim().toLowerCase())).join("|");
  }

  // ---- Assessment classification ----
  // Uses structured signals first (gradebook category, contentHandler, column
  // metadata); title keywords only as a last resort. Never invents certainty:
  // returns "Other" when signals are absent.
  function classifyAssessment({ column, content } = {}) {
    const col = column || {};
    const cont = content || {};
    const handler = (cont.contentHandler && cont.contentHandler.id) || cont.handler || "";
    const category = col.gradebookCategory || col.category || col.gradebookCategoryId || "";
    const catName = (typeof category === "object" ? (category.title || category.name) : category) || "";
    const colName = [col.name, col.displayName].filter(Boolean).join(" ");
    const hay = `${catName} ${colName}`.toLowerCase();

    // Attendance: usually a dedicated category or explicit column.
    if (/attendance/.test(hay)) return "Attendance";
    // Manual grade columns: Blackboard marks these; title fallback last.
    if (col.isManualColumn === true || /manual/.test(String(col.calculationType || "").toLowerCase())) return "Manual";
    // Test/quiz vs exam: prefer category, then handler subtype, then title.
    if (/exam|final|midterm|mid-term/.test(hay)) return "Exam";
    if (/test|quiz/.test(hay)) return "Quiz";
    // Assignment handlers without test semantics.
    if (/assignment/.test(String(handler).toLowerCase())) return "Assignment";
    if (/assess|survey/.test(String(handler).toLowerCase())) {
      // x-bb-asmt-test-link covers both Ultra assignments and tests.
      if (/test|quiz|exam/.test(hay)) return /exam/.test(hay) ? "Exam" : "Quiz";
      if (/assign/.test(hay) || !hay.trim()) return "Assignment";
    }
    if (/assign|homework|project|essay|lab|report|submission/.test(hay)) return "Assignment";
    return "Other";
  }

  // ---- Current-course detection ----
  // Combines structured signals; never relies solely on name formatting.
  // Returns { current: bool, reasons: [] }.
  function isCurrentCourse(course, membership, termsById, nowMs) {
    const now = nowMs ?? Date.now();
    const c = course || {};
    const term = termsById && termsById.get(c.termId || c.term_id);
    const duration = (c.availability && c.availability.duration) || c.duration || {};
    const windows = [[term || {}, "term"], [duration, "course"]];
    const result = (status, reason) => ({ current: status === "current", status,
      score: status === "current" ? 3 : 0, reasons: [reason] });
    if (c.isCompleted === true || c.status === "Completed") return result("completed", "Blackboard marks course completed");
    // Term dates take precedence. Availability and year hints do not override them.
    for (const [window, label] of windows) {
      const start = Date.parse(window.start || "");
      const end = Date.parse(window.end || "");
      if (Number.isFinite(start) && start > now) return result("upcoming", `before ${label} start`);
      if (Number.isFinite(end) && end < now) return result("past", `after ${label} end`);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end)
        return result("current", `within ${label} dates`);
    }
    return result("unknown", "no authoritative term or course date range");
  }

  // ---- Stable assessment identity ----
  // Strong evidence only: shared Blackboard IDs (contentId, columnId, calendar
  // dynamicCalendarItemProps.id, identical source IDs). Titles alone never merge.
  function assessmentMergeKey(a) {
    const ids = [a.column_id, a.content_id, a.calendar_id].filter(Boolean);
    if (ids.length) return `ids:${ids.map((x) => String(x).toLowerCase()).sort().join("+")}`;
    return null;
  }

  function mergeAssessments(list) {
    // Index by every strong ID each record carries.
    const idToGroup = new Map();
    const groups = [];
    function groupFor(record) {
      const ids = [record.column_id, record.content_id, record.calendar_id, record.source_id]
        .filter(Boolean).map((x) => `id:${String(x).toLowerCase()}`);
      let target = null;
      for (const id of ids) {
        if (idToGroup.has(id)) { target = idToGroup.get(id); break; }
      }
      if (!target) {
        target = [];
        groups.push(target);
      }
      for (const id of ids) {
        if (idToGroup.has(id) && idToGroup.get(id) !== target) {
          // Two groups share an ID: union them (transitive closure).
          const other = idToGroup.get(id);
          for (const r of other) { if (!target.includes(r)) target.push(r); }
          const idx = groups.indexOf(other);
          if (idx >= 0) groups.splice(idx, 1);
          for (const [k, v] of idToGroup) if (v === other) idToGroup.set(k, target);
        }
        idToGroup.set(id, target);
      }
      if (!target.includes(record)) target.push(record);
      return target;
    }
    const singletons = [];
    for (const r of list) {
      const hasId = r.column_id || r.content_id || r.calendar_id || r.source_id;
      if (!hasId) singletons.push(r);
      else groupFor(r);
    }
    const out = [];
    for (const g of groups) out.push(mergeGroup(g));
    // Records with no IDs at all are kept as-is (no title-based merging).
    for (const s of singletons) out.push(s);
    return out;
  }

  function mergeGroup(group) {
    if (group.length === 1) return group[0];
    const base = { ...group[0] };
    base.merged_source_ids = group.map((g) => g.source_id).filter(Boolean);
    base.merged_ids = {
      column_ids: [...new Set(group.map((g) => g.column_id).filter(Boolean))],
      content_ids: [...new Set(group.map((g) => g.content_id).filter(Boolean))],
      calendar_ids: [...new Set(group.map((g) => g.calendar_id).filter(Boolean))]
    };
    // Union strong IDs onto the top level so the merged record stays joinable.
    if (!base.column_id && base.merged_ids.column_ids.length) base.column_id = base.merged_ids.column_ids[0];
    if (!base.content_id && base.merged_ids.content_ids.length) base.content_id = base.merged_ids.content_ids[0];
    if (!base.calendar_id && base.merged_ids.calendar_ids.length) base.calendar_id = base.merged_ids.calendar_ids[0];
    for (const g of group.slice(1)) {
      for (const f of ["description", "due_date", "available_from", "available_until",
        "submission_status", "submitted_at", "grade", "possible", "percentage",
        "feedback", "attempt_id", "url", "type"]) {
        if ((base[f] == null || base[f] === "") && g[f] != null && g[f] !== "") base[f] = g[f];
      }
      if (g.description && (base.description || "").length < g.description.length) base.description = g.description;
      // Union attempts/feedback lists when present.
      if (Array.isArray(g.attempts) && g.attempts.length) {
        base.attempts = [...(base.attempts || []), ...g.attempts];
      }
    }
    if (Array.isArray(base.attempts)) {
      const seen = new Set();
      base.attempts = base.attempts.filter((a) => {
        const k = (a && (a.id || a.attempt_id)) || JSON.stringify(a);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return base;
  }

  // ---- Redaction ----
  // Removes/pseudonymizes user identifiers; preserves course/content/assessment IDs.
  function redactExport(data) {
    const clone = JSON.parse(JSON.stringify(data));
    const userMap = new Map();
    function token(prefix) {
      const n = userMap.size + 1;
      return `${prefix}_REDACTED_${n}`;
    }
    function redactUserId(v) {
      if (v == null) return v;
      const k = String(v);
      if (!userMap.has(k)) userMap.set(k, token("USER"));
      return userMap.get(k);
    }
    if (clone.user) {
      if (clone.user.id) clone.user.id = redactUserId(clone.user.id);
      if (clone.user.userName) clone.user.userName = "REDACTED";
      if (clone.user.email) clone.user.email = "REDACTED";
      if (clone.user.studentId) clone.user.studentId = "REDACTED";
      if (clone.user.externalId) clone.user.externalId = "REDACTED";
    }
    if (clone.diagnostics) {
      delete clone.diagnostics.userId;
      delete clone.diagnostics.userName;
    }
    const userish = ["userId", "user_id", "author_id", "createdById", "membership_id", "membershipId", "enrollment_id"];
    function walk(o) {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === "object") {
        for (const k of Object.keys(o)) {
          if (userish.includes(k) && typeof o[k] === "string") o[k] = redactUserId(o[k]);
          else if ((k === "email" || k === "studentId" || k === "userName") && typeof o[k] === "string") o[k] = "REDACTED";
          else if (k === "instructors" && Array.isArray(o[k])) {
            o[k] = o[k].map((ins) => ({ ...(ins || {}), email: ins && ins.email ? "REDACTED" : ins && ins.email, userId: ins && ins.userId ? redactUserId(ins.userId) : ins && ins.userId }));
          } else if (k === "author" && typeof o[k] === "string") {
            o[k] = redactUserId(o[k]);
          } else walk(o[k]);
        }
      }
    }
    walk(clone.courses);
    walk(clone.assessments);
    walk(clone.announcements);
    walk(clone.grades);
    walk(clone.content);
    walk(clone.materials);
    walk(clone.events);
    walk(clone.assignments);
    if (clone.diagnostics) walk(clone.diagnostics.samples);
    return clone;
  }

  // Submitted/graded work is never "overdue"; attendance columns are not deadlines.
  // InProgress is an unsubmitted draft in Blackboard, so it is NOT done.
  const DONE_STATUS = /^(graded|needsgrading|needs_grading|submitted|completed)$/i;
  // Only these attempt states mean the work was handed in (not NotAttempted/Abandoned/InProgress).
  const DONE_ATTEMPT = /^(needsgrading|needs_grading|completed|submitted)$/i;
  function hasRealGrade(grade) {
    if (typeof grade === "number") return Number.isFinite(grade);
    if (typeof grade !== "string") return false;
    const g = grade.trim();
    return g !== "" && g !== "-";
  }
  function deadlineFlags(a, nowMs) {
    const due = a && a.due_date ? Date.parse(a.due_date) : NaN;
    if (Number.isNaN(due) || (a && a.type === "Attendance")) return { is_upcoming: false, is_overdue: false };
    const done = DONE_STATUS.test(String(a.submission_status || "")) ||
      (Array.isArray(a.attempts) && a.attempts.some((x) => x && DONE_ATTEMPT.test(String(x.status || "")))) ||
      hasRealGrade(a.grade);
    return { is_upcoming: !done && due >= nowMs, is_overdue: !done && due < nowMs };
  }

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
      if (!fromUltra && !/instructor|faculty|teacher|\bta\b/i.test(role)) continue;
      const u = r.user || r;
      const nm = u.name || {};
      const name = [nm.given || u.givenName, nm.family || u.familyName].filter(Boolean).join(" ") || u.userName || null;
      const email = (u.contact && u.contact.email) || u.emailAddress || u.email || null;
      if (name || email) out.push({ name, email, userId: r.userId || u.id || null });
    }
    return out;
  }

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

  const api = { normKey, classifyAssessment, isCurrentCourse, assessmentMergeKey, mergeAssessments, redactExport, deadlineFlags, instructorsFrom, gradeSummary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.BBModel = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
