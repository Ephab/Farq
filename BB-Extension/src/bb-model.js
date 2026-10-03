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
    const now = nowMs || Date.now();
    const reasons = [];
    let score = 0;
    const c = course || {};
    const m = membership || {};

    const avail = (c.availability && c.availability.available) || c.availability;
    if (avail === "Yes" || avail === "Term" || avail === true) {
      score += 1;
      reasons.push("available");
    } else if (avail === "No" || avail === "Disabled" || avail === false) {
      score -= 3;
      reasons.push("unavailable");
    }

    const dur = (c.availability && (c.availability.duration || c.availability.adaptiveRelease)) || c.duration;
    if (dur && (dur.start || dur.end)) {
      const s = dur.start ? Date.parse(dur.start) : NaN;
      const e = dur.end ? Date.parse(dur.end) : NaN;
      if (!Number.isNaN(s) && !Number.isNaN(e)) {
        if (s <= now && now <= e) { score += 3; reasons.push("within course dates"); }
        else { score -= 2; reasons.push("outside course dates"); }
      } else if (!Number.isNaN(e)) {
        if (now <= e) { score += 1; reasons.push("before course end"); }
        else { score -= 2; reasons.push("after course end"); }
      }
    }

    const termId = c.termId || c.term_id;
    const term = termId && termsById ? termsById.get(termId) : null;
    if (term) {
      const s = term.start ? Date.parse(term.start) : NaN;
      const e = term.end ? Date.parse(term.end) : NaN;
      if (!Number.isNaN(s) && !Number.isNaN(e)) {
        if (s <= now && now <= e) { score += 3; reasons.push("current term"); }
        else { score -= 2; reasons.push("non-current term"); }
      }
    }

    // Enrollment recency: active enrollment within ~240 days suggests current.
    const enroll = m.enrollmentDate || m.enrollment || c.enrollmentDate;
    if (enroll) {
      const t = Date.parse(enroll);
      if (!Number.isNaN(t)) {
        const days = (now - t) / 864e5;
        if (days >= 0 && days <= 240) { score += 1; reasons.push("recent enrollment"); }
        else if (days > 540) { score -= 1; reasons.push("old enrollment"); }
      }
    }

    // Course-code year hint: weakest signal, tiebreaker only.
    const code = [c.courseId, c.externalId, c.displayName, c.name].filter(Boolean).join(" ");
    const yearMatch = code.match(/(20\d{2})/);
    if (yearMatch) {
      const y = parseInt(yearMatch[1], 10);
      const nowY = new Date(now).getFullYear();
      if (y === nowY || y === nowY - 0) { score += 1; reasons.push("current year hint"); }
      else if (y < nowY - 1) { score -= 1; reasons.push("old year hint"); }
    }

    return { current: score > 0, score, reasons };
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
          } else if (k === "author" && typeof o[k] === "string" && /^_/.test(o[k])) {
            o[k] = redactUserId(o[k]);
          } else walk(o[k]);
        }
      }
    }
    walk(clone.courses);
    walk(clone.assessments);
    walk(clone.announcements);
    walk(clone.grades);
    return clone;
  }

  const api = { normKey, classifyAssessment, isCurrentCourse, assessmentMergeKey, mergeAssessments, redactExport };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.BBModel = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
