/* IAU Blackboard console extractor v2 — copy/paste into DevTools on vle.iau.edu.sa.
 * Same pipeline as the extension (src/extractor.js), standalone for no-install use.
 * Read-only (GET only), uses your existing login cookies. No password ever.
 *
 * Options (set before pasting, or edit below):
 *   window.BB_EXTRACT_OPTIONS = { scope: "current", redact: false };
 * scope "current" (default) exports only current courses; "all" exports history too.
 *
 * Steps:
 *  1. Log into https://vle.iau.edu.sa/ultra as a student (complete SSO/MFA yourself).
 *  2. Open DevTools (F12) -> Console.
 *  3. Paste this whole file, press Enter.
 *  4. JSON downloads automatically + is returned. A text summary is logged.
 */
(async function () {
  const OPTS = Object.assign({ scope: "current", redact: false }, (window.BB_EXTRACT_OPTIONS || {}));
  const origin = location.origin;
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const until = new Date(Date.now() + 180 * 864e5).toISOString();
  const nowISO = () => new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- rich text (fixes "[object Object]" announcements) ---
  function extractRichText(v) {
    if (v == null) return { text: null, html: null };
    if (typeof v === "string") { const s = v.trim(); return { text: s || null, html: /<[a-z][\s\S]*>/i.test(s) ? s : null }; }
    if (Array.isArray(v)) { for (const i of v) { const r = extractRichText(i); if (r.text) return r; } return { text: null, html: null }; }
    if (typeof v === "object") {
      let text = null, html = null;
      for (const k of ["rawText", "plainText", "displayText", "text", "message", "value", "content", "html", "body"]) {
        if (v[k] == null) continue;
        const r = extractRichText(v[k]);
        if (!r.text) continue;
        if (!text) text = r.text;
        if (!html && r.html) html = r.html;
        else if (!html && typeof v[k] === "string" && /<[a-z][\s\S]*>/i.test(v[k])) html = v[k];
        if (text && html) break;
      }
      if (text) return { text, html };
      for (const k of Object.keys(v)) if (typeof v[k] === "string" && v[k].trim()) return { text: v[k].trim(), html: null };
      return { text: null, html: null };
    }
    return { text: String(v), html: null };
  }
  function stripHtml(h) {
    if (h == null) return null;
    if (typeof h !== "string") h = extractRichText(h).text;
    if (h == null) return null;
    const d = document.createElement("div"); d.innerHTML = h;
    const t = (d.textContent || "").replace(/\s+/g, " ").trim();
    return t || null;
  }
  function ts(v) {
    if (v == null) return null;
    if (typeof v === "string") {
      const s = v.trim(); if (!s) return null;
      let m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (typeof v === "number") { const d = new Date(v < 1e12 ? v * 1000 : v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
    return null;
  }
  function pct(s, p) { return (typeof s === "number" && typeof p === "number" && p) ? Math.round((s / p) * 1000) / 10 : null; }
  function classify(column, contentHandler) {
    const hay = [column && (column.gradebookCategory && (column.gradebookCategory.title || column.gradebookCategory.name) || column.gradebookCategoryId), column && (column.name || column.displayName)].filter(Boolean).join(" ").toLowerCase();
    const h = String(contentHandler || "").toLowerCase();
    if (/attendance/.test(hay)) return "Attendance";
    if (/exam|final|midterm|mid-term/.test(hay)) return "Exam";
    if (/test|quiz/.test(hay)) return "Quiz";
    if (/assignment/.test(h)) return "Assignment";
    if (/assign|homework|project|essay|lab|report|submission/.test(hay)) return "Assignment";
    if (/assess|survey|grade/.test(h)) return "Assignment";
    return "Other";
  }

  async function bbGet(path, retries = 2) {
    let last;
    for (let a = 0; a <= retries; a++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(origin + path, { credentials: "include", headers: { Accept: "application/json" }, signal: ctrl.signal });
        if (!r.ok) { const e = new Error(`GET ${path} -> ${r.status}`); e.status = r.status; if ((r.status === 429 || (r.status >= 500 && r.status <= 599)) && a < retries) { last = e; await sleep(Math.min(1000 * 2 ** a, 5000)); continue; } throw e; }
        return await r.json();
      } catch (e) {
        if (e && e.name === "AbortError" && a < retries) { last = e; await sleep(Math.min(1000 * 2 ** a, 5000)); continue; }
        if (a >= retries) throw e;
        last = e;
        await sleep(Math.min(1000 * 2 ** a, 5000));
      } finally { clearTimeout(t); }
    }
    throw last;
  }
  async function paged(path) {
    const out = []; let offset = 0;
    for (let i = 0; i < 10; i++) {
      const sep = path.includes("?") ? "&" : "?";
      const d = await bbGet(`${path}${sep}limit=100&offset=${offset}`);
      const res = d.results || [];
      out.push(...res);
      if (!d.paging || !d.paging.nextPage) break;
      offset += 100;
    }
    return out;
  }
  const courseUrl = (id) => `${origin}/ultra/courses/${id}/outline`;
  const contentUrl = (cid, coid) => `${origin}/ultra/courses/${cid}/outline?contentId=${encodeURIComponent(coid)}`;

  const me = await bbGet("/learn/api/v1/users/me").catch((e) => { throw new Error("Not logged in: " + e.message); });
  const memberships = await paged("/learn/api/v1/users/me/memberships?expand=course").catch(() => []);
  let termsById = new Map();
  try {
    const terms = await paged("/learn/api/v1/terms").catch(() => []);
    for (const t of terms) if (t && t.id) termsById.set(t.id, t);
  } catch {}
  const now = Date.now();
  const courses = [], byId = new Map();
  for (const m of memberships) {
    const c = m.course || {}; const cid = c.id || m.courseId;
    if (!cid || byId.has(cid)) continue;
    const avail = (c.availability && c.availability.available) ?? null;
    let score = 0;
    if (avail === "Yes" || avail === "Term") score++;
    if (avail === "No" || avail === "Disabled") score -= 3;
    const term = (c.termId && termsById.get(c.termId)) || null;
    if (term && term.availability && term.availability.duration) {
      const s = Date.parse(term.availability.duration.start || ""), e = Date.parse(term.availability.duration.end || "");
      if (!Number.isNaN(s) && !Number.isNaN(e)) score += (s <= now && now <= e) ? 3 : -2;
    }
    if (m.enrollmentDate) { const d = (now - Date.parse(m.enrollmentDate)) / 864e5; if (d >= 0 && d <= 240) score++; else if (d > 540) score--; }
    const e = { id: cid, course_id: cid, courseId: c.courseId || null, code: c.courseId || null, name: c.displayName || c.name || cid, availability: avail, enrollment_date: m.enrollmentDate || null, role: m.courseRoleId || null, term_id: c.termId || null, created: ts(c.created), modified: ts(c.modified), is_current: score > 0, url: courseUrl(cid), _membership_id: m.id || null };
    byId.set(cid, e); courses.push(e);
  }
  const inScope = OPTS.scope === "all" ? courses : courses.filter((c) => c.is_current);
  const assessments = [], announcements = [], grades = [], events = [], content = [];
  const failed = [];
  for (const course of inScope) {
    const cid = course.id, cname = course.name;
    try {
      const roster = await paged(`/learn/api/v1/courses/${encodeURIComponent(cid)}/users?expand=user`);
      const ins = roster.filter((r) => /instructor|faculty/i.test(r.courseRoleId || "")).map((r) => ({ name: [r.user?.name?.given, r.user?.name?.family].filter(Boolean).join(" ") || r.userId, email: r.user?.contact?.email || null }));
      if (ins.length) course.instructors = ins;
    } catch (e) { failed.push(`roster:${cid}: ${e.message}`); }
    const contentIndex = new Map();
    try {
      const tops = await paged(`/learn/api/v1/courses/${encodeURIComponent(cid)}/contents`);
      const q = tops.map((t) => ({ item: t, parentId: null, path: [t.title || "(untitled)"] }));
      const seen = new Set();
      while (q.length) {
        const { item, parentId, path } = q.shift();
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        const h = item.contentHandler?.id || "";
        const r = extractRichText(item.body);
        const rec = { course: cname, course_id: cid, title: item.title || "(untitled)", content_id: item.id, source_id: item.id, type: h.replace("resource/x-bb-", "") || "Other", handler: h || null, parent_id: parentId, path: path.join(" / "), description: r.text, body_text: r.text, body_html: r.html || (typeof item.body === "string" ? item.body : null), availability: item.availability?.available ?? null, created: ts(item.created), modified: ts(item.modified), url: contentUrl(cid, item.id) };
        contentIndex.set(item.id, rec); content.push(rec);
        if (/assess|assign|test|survey|grade/i.test(h)) assessments.push({ course: cname, course_id: cid, title: rec.title, description: rec.description, due_date: ts(item.dates?.due), submission_status: null, grade: null, possible: null, type: classify(null, h), content_id: rec.content_id, column_id: null, url: rec.url, source_id: rec.content_id, source: "content" });
        if (item.hasChildren) { try { const kids = await paged(`/learn/api/v1/courses/${encodeURIComponent(cid)}/contents/${encodeURIComponent(item.id)}/children`); for (const k of kids) q.push({ item: k, parentId: item.id, path: [...path, k.title || "(untitled)"] }); } catch {} }
      }
    } catch (e) { failed.push(`contents:${cid}: ${e.message}`); }
    try {
      const anns = await paged(`/learn/api/v1/courses/${encodeURIComponent(cid)}/announcements`);
      for (const a of anns) {
        const r = extractRichText(a.body);
        announcements.push({ course: cname, course_id: cid, title: (typeof a.title === "string" ? a.title : extractRichText(a.title).text) || "(announcement)", body_text: r.text, body_html: r.html || (typeof a.body === "string" ? a.body : null), body: r.text, created_at: ts(a.created), updated_at: ts(a.modified), author: (a.createdBy && (a.createdBy.userName || a.createdBy.id)) || null, announcement_id: a.id || null, source_id: a.id || null, url: courseUrl(cid) });
      }
    } catch (e) { failed.push(`announcements:${cid}: ${e.message}`); }
    let cols = [];
    try { cols = await paged(`/learn/api/public/v2/courses/${encodeURIComponent(cid)}/gradebook/columns`); } catch (e) { failed.push(`columns:${cid}: ${e.message}`); }
    const colMap = new Map(cols.map((c) => [c.id, c]));
    for (const c of cols) assessments.push({ course: cname, course_id: cid, title: c.name || c.displayName, description: extractRichText(c.description).text, due_date: ts(c.grading?.due), submission_status: null, grade: null, possible: c.score?.possible ?? null, type: classify(c, null), content_id: c.contentId || null, column_id: c.id, url: contentUrl(cid, c.contentId || c.id), source_id: c.id, source: "gradebook-column" });
    // Documented student grade paths only (never /users/{uid}/grades).
    let userGrades = [];
    try {
      const g = await bbGet(`/learn/api/public/v1/courses/${encodeURIComponent(cid)}/gradebook/users/${encodeURIComponent(me.id)}?limit=100`);
      userGrades = g.results || g.grades || [];
    } catch {
      for (const col of cols.slice(0, 10)) {
        try {
          const one = await bbGet(`/learn/api/public/v1/courses/${encodeURIComponent(cid)}/gradebook/columns/${encodeURIComponent(col.id)}/users/${encodeURIComponent(me.id)}`, 1);
          if (one && (one.columnId || one.status)) userGrades.push(one);
        } catch {}
      }
    }
    const gradeByCol = new Map();
    for (const gr of userGrades) {
      if (!gr || typeof gr !== "object") continue;
      const col = colMap.get(gr.columnId) || {};
      const score = typeof gr.score === "number" ? gr.score : gr.displayGrade?.score ?? null;
      const possible = gr.displayGrade?.possible ?? col.score?.possible ?? null;
      grades.push({ course: cname, course_id: cid, item: col.name || gr.columnId, column_id: gr.columnId || null, score, possible, percentage: pct(score, possible), grade: gr.displayGrade?.text ?? gr.text ?? null, status: gr.status || null, feedback: extractRichText(gr.feedback).text, posted: ts(gr.modified || gr.created), url: contentUrl(cid, col.contentId || gr.columnId || cid), source_id: gr.columnId ? `grade:${cid}:${gr.columnId}` : null });
      if (gr.columnId) gradeByCol.set(gr.columnId, gr);
    }
    for (const a of assessments) {
      if (!a.column_id) continue;
      const gr = gradeByCol.get(a.column_id);
      if (gr) { a.submission_status = gr.status || null; a.grade = gr.displayGrade?.text ?? a.grade; const s = typeof gr.score === "number" ? gr.score : gr.displayGrade?.score ?? null; a.percentage = pct(s, a.possible); }
    }
    try {
      const cal = await bbGet(`/learn/api/public/v1/calendars/items?courseId=${encodeURIComponent(cid)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
      for (const it of (cal.results || [])) events.push({ title: it.title, course: cname, course_id: cid, start: ts(it.start), end: ts(it.end), due_date: ts(it.end || it.start), type: it.type || null, url: courseUrl(cid), source_id: it.id ? `cal:${it.id}` : null, uid: it.id || null });
    } catch (e) { failed.push(`calendar:${cid}: ${e.message}`); }
  }
  // ID-stable merge (shared IDs only; never title-only).
  const byIds = new Map(); const merged = [];
  for (const a of assessments) {
    const ids = [a.column_id, a.content_id].filter(Boolean).map((x) => String(x).toLowerCase());
    let target = null;
    for (const id of ids) if (byIds.has("id:" + id)) { target = byIds.get("id:" + id); break; }
    if (!target) { target = []; merged.push(target); }
    for (const id of ids) {
      if (byIds.has("id:" + id) && byIds.get("id:" + id) !== target) {
        const other = byIds.get("id:" + id);
        for (const r of other) if (!target.includes(r)) target.push(r);
        merged.splice(merged.indexOf(other), 1);
        for (const [k, v] of byIds) if (v === other) byIds.set(k, target);
      }
      byIds.set("id:" + id, target);
    }
    if (!target.includes(a)) target.push(a);
  }
  const assessmentsM = [];
  for (const g of merged) {
    if (g.length === 1) { assessmentsM.push(g[0]); continue; }
    const base = { ...g[0], merged_source_ids: g.map((x) => x.source_id).filter(Boolean) };
    for (const x of g.slice(1)) for (const f of ["description", "due_date", "submission_status", "grade", "possible", "url", "type"]) if ((base[f] == null || base[f] === "") && x[f] != null) base[f] = x[f];
    assessmentsM.push(base);
  }
  let data = { exported_at: nowISO(), source: "IAU Blackboard", origin, user: { id: me.id, userName: me.userName || null }, courses: OPTS.scope === "all" ? courses : inScope, assessments: assessmentsM, assignments: assessmentsM, announcements, grades, events, content, materials: content, diagnostics: { scope: OPTS.scope, failed_sources: failed } };
  if (OPTS.redact) {
    const s = JSON.stringify(data, (k, v) => (["userId", "user_id", "email", "userName", "studentId"].includes(k) && typeof v === "string" ? "REDACTED" : v));
    data = JSON.parse(s);
    if (data.user) data.user.id = "USER_REDACTED_1";
  }
  const sum = `Courses:       ${inScope.length} current / ${courses.length} total\nAssessments:   ${assessmentsM.length}\nAnnouncements: ${announcements.length}\nGrades:        ${grades.length}\nEvents:        ${events.length}\nContent:       ${content.length}\n\nFailed sources:\n${failed.length ? failed.map((f) => `* ${f}`).join("\n") : "(none)"}`;
  console.log("[BB]\n" + sum);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `iau-blackboard-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return data;
})();
