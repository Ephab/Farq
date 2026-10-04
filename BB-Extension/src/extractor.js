/* IAU Blackboard read-only extractor core (v2).
 * Builds on the proven authenticated-session pipeline; does not replace it with
 * DOM scraping. GET requests only. No password/MFA handling. Uses the browser's
 * existing login cookies via same-origin fetch.
 *
 * Endpoint policy (no brute-force enumeration):
 *  - Identity/courses/memberships/contents/announcements/columns: the endpoints
 *    this extractor has historically used successfully (kept as-is).
 *  - Grades: documented student-readable paths only —
 *      GET /learn/api/public/v1/courses/{courseId}/gradebook/users/{userId}
 *      GET /learn/api/public/v1|courses/{courseId}/gradebook/columns/{columnId}/users/{userId}
 *    The previously attempted `/users/{uid}/grades` path 404s and is NOT retried.
 *  - Calendar: existing structured calendar sweep (kept) + ICS fallback (kept).
 *
 * Usage (console, on https://vle.iau.edu.sa/ultra...):
 *   const data = await BBExtractor.extractAll({ origin: location.origin, scope: "current" });
 *
 * Options: { origin, scope: "current"|"all" (default "current"),
 *   redact: false, concurrency: 3, timeoutMs: 20000, retries: 2,
 *   since, until, icsEvents: [], onProgress(msg) }
 */
(function (global) {
  "use strict";

  const DEFAULT_ORIGIN = "https://vle.iau.edu.sa";
  // Known-bad path: returns 404 for students. Documented here so nobody re-adds it.
  const KNOWN_BAD_GRADE_PATHS = [
    "/learn/api/public/v2/courses/{courseId}/users/{userId}/grades"
  ];

  function loadDeps() {
    let U = global.BBUtils;
    let M = global.BBModel;
    if ((!U || !M) && typeof require !== "undefined") {
      try { U = U || require("./bb-utils.js"); } catch { /* browser */ }
      try { M = M || require("./bb-model.js"); } catch { /* browser */ }
    }
    if (!U) throw new Error("BBUtils not loaded (src/bb-utils.js must load before extractor.js)");
    if (!M) throw new Error("BBModel not loaded (src/bb-model.js must load before extractor.js)");
    return { U, M };
  }

  function nowISO() { return new Date().toISOString(); }

  function courseUrl(origin, courseInternalId) {
    return `${origin}/ultra/courses/${courseInternalId}/outline`;
  }
  function contentUrl(origin, courseInternalId, contentId) {
    return `${origin}/ultra/courses/${courseInternalId}/outline?contentId=${encodeURIComponent(contentId)}`;
  }

  function dedupeByKey(records, keyFn) {
    const seen = new Set();
    const out = [];
    for (const r of records) {
      const k = keyFn(r);
      if (!k) { out.push(r); continue; }
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }

  function handlerOf(item) {
    const h = item && item.contentHandler;
    return (typeof h === "string" ? h : (h && h.id)) || (item && item.handler) || "";
  }

  // Map raw contentHandler IDs (documented by Anthology) to friendly types.
  function contentTypeOf(item) {
    const h = handlerOf(item);
    switch (h) {
      case "resource/x-bb-folder": return "Folder";
      case "resource/x-bb-file": return "File";
      case "resource/x-bb-document": return "Document";
      case "resource/x-bb-externallink": return "Link";
      case "resource/x-bb-courselink": return "CourseLink";
      case "resource/x-bb-forumlink": return "DiscussionLink";
      case "resource/x-bb-blti-link": return "LTI";
      case "resource/x-bb-asmt-test-link": return "Assessment";
      case "resource/x-bb-assignment": return "Assignment";
      default: return h ? h.replace("resource/x-bb-", "x-bb-") : "Other";
    }
  }

  function percentageOf(score, possible) {
    if (typeof score !== "number" || typeof possible !== "number" || !possible) return null;
    return Math.round((score / possible) * 1000) / 10;
  }

  async function extractAll(options = {}) {
    const { U, M } = loadDeps();
    const origin = (options.origin || (typeof location !== "undefined" ? location.origin : DEFAULT_ORIGIN)).replace(/\/$/, "");
    const scope = options.scope === "all" ? "all" : "current";
    const wantRedact = !!options.redact;
    const concurrency = Math.max(1, Math.min(options.concurrency || 3, 5));
    const timeoutMs = options.timeoutMs || 20000;
    const retries = options.retries != null ? options.retries : 2;
    const since = options.since || new Date(Date.now() - 120 * 864e5).toISOString();
    const until = options.until || new Date(Date.now() + 180 * 864e5).toISOString();
    const windows = U.calendarWindows(since, until);
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const prog = (m) => { try { if (onProgress) onProgress(m); } catch { /* ignore */ } };
    const samples = options.captureSamples ? {} : null;
    const USER_KEYS = /^(email|emailAddress|userName|studentId|contact|name|givenName|familyName|displayName|nickName|middleName|externalId|uuid|userId|createdBy|creator)$/;
    const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    function sample(family, raw) {
      if (!samples || samples[family] || !raw || typeof raw !== "object") return;
      samples[family] = JSON.parse(JSON.stringify(raw, (k, v) => (USER_KEYS.test(k) ? undefined : (typeof v === "string" ? (EMAIL_RE.test(v) ? "REDACTED" : v.slice(0, 120)) : v))));
    }

    const startedAt = Date.now();
    const sources = [];
    function recordSource(source, endpoint, status, count, ms, error) {
      sources.push({
        source, endpoint, status,
        count: count == null ? 0 : count,
        elapsed_ms: Math.round(ms),
        ...(error ? { error: U.sanitizeError(error) } : {})
      });
    }
    async function track(source, endpoint, fn) {
      const t0 = Date.now();
      try {
        const value = await fn();
        const count = Array.isArray(value) ? value.length : (value && value.count != null ? value.count : 1);
        recordSource(source, endpoint, value && value.truncated ? "partial" : "ok", count, Date.now() - t0);
        return value;
      } catch (e) {
        const status = e && e.status === 403 ? "forbidden" : (e && e.status ? `http_${e.status}` : "failed");
        recordSource(source, endpoint, status, 0, Date.now() - t0, e);
        throw e;
      }
    }

    const diagnostics = { origin, startedAt: nowISO(), scope, endpointStatus: {} };
    const courses = [];
    const assessments = [];
    const announcements = [];
    const grades = [];
    const events = [];
    const content = [];

    // ---- 1. identity (proven endpoint, kept) ----
    let me = null;
    try {
      me = await track("identity", "GET /learn/api/v1/users/me",
        () => U.getJson(origin, "/learn/api/v1/users/me", { timeoutMs, retries }));
      diagnostics.endpointStatus["/learn/api/v1/users/me"] = "ok";
    } catch (e) {
      diagnostics.endpointStatus["/learn/api/v1/users/me"] = `failed: ${U.sanitizeError(e)}`;
      throw new Error(`Not logged into Blackboard at ${origin} (${U.sanitizeError(e)}). Open ${origin}/ultra and log in first.`);
    }
    const myUserId = me.id;

    // ---- 2. memberships -> courses (proven endpoint, kept) ----
    let memberships = [];
    try {
      memberships = await track("memberships", "GET /learn/api/v1/users/me/memberships",
        () => U.pagedGet(origin, "/learn/api/v1/users/me/memberships?expand=course", { limit: 100, maxPages: 10, timeoutMs, retries }));
      diagnostics.endpointStatus["/learn/api/v1/users/me/memberships"] = "ok";
    } catch (e) {
      diagnostics.endpointStatus["/learn/api/v1/users/me/memberships"] = `failed: ${U.sanitizeError(e)}`;
    }
    sample("memberships", memberships[0]);
    const membershipByCourse = new Map();
    for (const m of memberships) {
      const cid = (m.course && m.course.id) || m.courseId;
      if (cid && !membershipByCourse.has(cid)) membershipByCourse.set(cid, m);
    }

    // ---- 2b. terms (for current-course detection; best-effort) ----
    let termsById = new Map();
    try {
      const terms = await track("terms", "GET /learn/api/v1/terms",
        () => U.pagedGet(origin, "/learn/api/v1/terms", { limit: 100, maxPages: 5, timeoutMs, retries }));
      for (const t of terms) {
        if (t && t.id) termsById.set(t.id, { name: t.name || null, start: t.availability && t.availability.duration && t.availability.duration.start, end: t.availability && t.availability.duration && t.availability.duration.end });
      }
    } catch (e) {
      recordSource("terms", "GET /learn/api/v1/terms", "skipped", 0, 0, e);
    }

    const courseById = new Map();
    for (const m of memberships) {
      const c = m.course || {};
      const cid = c.id || m.courseId;
      if (!cid || courseById.has(cid)) continue;
      const termId = c.termId || c.term_id || (c.term && c.term.id) || (m.term && m.term.id);
      if (termId && !termsById.has(termId) && c.term) {
        const d = (c.term.availability && c.term.availability.duration) || c.term.duration || {};
        termsById.set(termId, { name: c.term.name || null, start: d.start, end: d.end });
      }
      const current = M.isCurrentCourse({ ...c, termId }, m, termsById);
      const entry = {
        id: cid,
        course_id: cid,
        courseId: c.courseId || c.externalId || null,
        code: c.courseId || c.externalId || null,
        name: c.displayName || c.name || "(unnamed course)",
        availability: (c.availability && c.availability.available) ?? null,
        availability_duration: (c.availability && (c.availability.duration || null)) || null,
        enrollment_date: m.enrollmentDate || null,
        enrollment: m.enrollmentDate || null,
        role: m.courseRoleId || m.role || null,
        term_id: termId || null,
        term_name: (termsById.get(termId) || {}).name || null,
        term_start: U.normalizeTimestamp((termsById.get(termId) || {}).start),
        term_end: U.normalizeTimestamp((termsById.get(termId) || {}).end),
        course_status: current.status,
        final_grade: null,
        created: U.normalizeTimestamp(c.created),
        modified: U.normalizeTimestamp(c.modified),
        is_current: current.current,
        current_score: current.score,
        current_reasons: current.reasons,
        url: courseUrl(origin, cid),
        _membership_id: m.id || null
      };
      courseById.set(cid, entry);
      courses.push(entry);
    }

    // Fallback if memberships empty (proven fallback, kept).
    if (courses.length === 0) {
      try {
        const data = await track("courses-fallback", "GET /learn/api/public/v1/users/{id}/courses",
          () => U.pagedGet(origin, `/learn/api/public/v1/users/${encodeURIComponent(myUserId)}/courses`, { limit: 100, maxPages: 5, timeoutMs, retries }));
        for (const c of data) {
          const cid = c.courseId || c.id;
          if (!cid || courseById.has(cid)) continue;
          const e = { id: cid, course_id: cid, courseId: c.courseId || null, code: c.courseId || null, name: c.displayName || c.name || cid, availability: null, enrollment_date: null, role: null, term_id: null, term_name: null, final_grade: null, created: null, modified: null, is_current: false, course_status: "unknown", current_reasons: ["fallback-listing"], url: courseUrl(origin, cid) };
          courseById.set(cid, e);
          courses.push(e);
        }
      } catch (e) {
        diagnostics.endpointStatus["/learn/api/public/v1/users/{id}/courses"] = `failed: ${U.sanitizeError(e)}`;
      }
    }

    const inScope = scope === "all" ? courses : courses.filter((c) => c.is_current);
    const scopedNote = scope === "all" ? null : (courses.length && inScope.length === 0 ? "current-filter-empty" : null);
    prog(`Courses: ${inScope.length} in scope / ${courses.length} total`);

    // ---- 3. per-course reads (isolated; conservative concurrency) ----
    const results = await U.limitedMap(inScope, concurrency, async (course) => {
      const cid = course.id;
      const cname = course.name;
      const per = { assessments: [], announcements: [], grades: [], events: [], content: [] };

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
          sample(`instructors-${label}`, payload);
          const found = M.instructorsFrom(payload);
          recordSource(`instructors:${cid}`, `GET ${label}`, found.length ? "ok" : "probe_empty", found.length, Date.now() - t0);
          if (found.length) { course.instructors = found; course.instructor_source = label; break; }
        } catch (e) {
          recordSource(`instructors:${cid}`, `GET ${label}`, `probe_${e && e.status ? `http_${e.status}` : "failed"}`, 0, Date.now() - t0, e);
        }
      }

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
      sample("contents", tops && tops[0]);
      const attachmentJobs = [];
      let childErrors = 0;
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
            file: (item.contentHandler && item.contentHandler.file) || null,
            external_link: (item.contentHandler && item.contentHandler.url) || item.externalLink || null
          };
          contentIndex.set(item.id, rec);
          per.content.push(rec);
          if (/x-bb-(file|document|assignment)/.test(handler)) attachmentJobs.push(rec);
          const isFolder = item.hasChildren || /x-bb-(folder|lesson)/.test(handler);
          if (isFolder) {
            try {
              const kids = await U.pagedGet(origin, `${base}/${encodeURIComponent(item.id)}/children`, { limit: 100, maxPages: 5, timeoutMs, retries });
              if (kids.truncated) childErrors++;
              for (const k of kids) queue.push({ item: k, parentId: item.id, path: [...path, k.title || "(untitled)"] });
            } catch { childErrors++; /* keep what we have */ }
          }
        }
        // A folder we could not open hides its items: mark the listing partial so consumers
        // never treat the missing items as deleted.
        if (childErrors) {
          const entry = sources.filter((s) => s.source === `contents:${cid}` && s.status === "ok").pop();
          if (entry) Object.assign(entry, { status: "partial", children_errors: childErrors });
        }
      }

      // 3b'. attachment metadata (documented); bytes are never fetched here.
      const attT0 = Date.now();
      let attListingErrors = 0;
      await U.limitedMap(attachmentJobs, 2, async (rec) => {
        const listPath = `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/contents/${encodeURIComponent(rec.content_id)}/attachments`;
        try {
          const res = { results: await U.pagedGet(origin, listPath, { limit: 100, maxPages: 20, timeoutMs, retries: 1 }) };
          if (res.results.truncated) attListingErrors++;
          sample("attachments", (res.results || [])[0]);
          rec.attachments = (res.results || []).filter((a) => a && a.id).map((a) => ({
            id: a.id || null,
            name: a.fileName || a.name || null,
            mime: a.mimeType || null,
            size: a.fileSize ?? a.size ?? null,
            download_url: `${origin}${listPath}/${encodeURIComponent(a.id)}/download`
          }));
        } catch (e) {
          if (!(e && e.status === 404)) attListingErrors++; // 404 = no attachments, normal
        }
      }, true);

      // Some Original/Ultra materials expose files as links rather than attachment rows.
      // Only use observed same-origin file URLs; never guess storage paths or follow LTI links.
      for (const rec of per.content) {
        const candidates = [];
        const file = rec.file || {};
        if (file.url || file.downloadUrl) candidates.push([file.url || file.downloadUrl, file.fileName || rec.title]);
        const html = rec.body_html || "";
        // Ultra embeds files in data-bbfile JSON. Their opaque WebDAV URLs have no
        // extension; the filename lives in this metadata, not in the anchor text.
        for (const match of html.matchAll(/data-bbfile\s*=\s*(["'])(.*?)\1/gi)) {
          try {
            const decoded = match[2].replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
              .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
            const embeddedFile = JSON.parse(decoded);
            if (typeof embeddedFile.resourceUrl === "string") {
              candidates.push([embeddedFile.resourceUrl, embeddedFile.linkName || embeddedFile.displayName,
                embeddedFile.mimeType]);
            }
          } catch { /* malformed embedded metadata is untrusted */ }
        }
        for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push([match[1], null]);
        for (const [rawUrl, label, mime] of candidates) {
          try {
            const url = new URL(rawUrl.replace(/&amp;/g, "&"), origin);
            if (url.origin !== origin || !(/\.(pdf|pptx?|docx|txt|md)(?:$|\/)/i.test(url.pathname)
              || /\.(pdf|pptx?|docx|txt|md)$/i.test(label || ""))) continue;
            if (rec.attachments.some((a) => a.download_url === url.href)) continue;
            const name = label || decodeURIComponent(url.pathname.split("/").pop()) || rec.title;
            rec.attachments.push({ id: `link:${url.pathname}`, name, mime: mime || file.mimeType || null,
              size: null, download_url: url.href });
          } catch { /* malformed course link */ }
        }
        delete rec.file;
      }
      const attCount = per.content.reduce((n, r) => n + r.attachments.length, 0);
      recordSource(`attachments:${cid}`, "GET public attachments + observed file links",
        (!tops || tops.truncated || childErrors || attListingErrors) ? "partial" : "ok", attCount, Date.now() - attT0);
      Object.assign(sources[sources.length - 1], { truncated: false, listing_errors: attListingErrors });

      // 3c. announcements (proven endpoint, kept) — fixed rich-text extraction.
      try {
        const anns = await track(`announcements:${cid}`, "GET /learn/api/v1/courses/{id}/announcements",
          () => U.pagedGet(origin, `/learn/api/v1/courses/${encodeURIComponent(cid)}/announcements`, { limit: 100, maxPages: 5, timeoutMs, retries }));
        sample("announcements", anns[0]);
        for (const a of anns) {
          const r = U.extractRichText(a.body);
          const authorRaw = a.createdBy || a.creator || null;
          const author = typeof authorRaw === "string" ? authorRaw
            : authorRaw ? (authorRaw.userName || authorRaw.id || null) : null;
          per.announcements.push({
            course: cname, course_id: cid,
            title: (typeof a.title === "string" ? a.title : U.extractRichText(a.title).text) || "(announcement)",
            body_text: U.htmlToText(r.text),
            body_html: r.html || (r.text && /<[a-z]/i.test(r.text) ? r.text : null),
            body: U.htmlToText(r.text),
            created_at: U.normalizeTimestamp(a.created),
            updated_at: U.normalizeTimestamp(a.modified),
            posted_on: U.normalizeTimestamp(a.created || a.modified),
            author,
            announcement_id: a.id || null,
            source_id: a.id || null,
            url: courseUrl(origin, cid)
          });
        }
      } catch { /* recorded */ }

      // 3d. gradebook columns (proven endpoint, kept) — metadata for assessments.
      let columns = [];
      try {
        columns = await track(`columns:${cid}`, "GET /learn/api/public/v2/courses/{id}/gradebook/columns",
          () => U.pagedGet(origin, `/learn/api/public/v2/courses/${encodeURIComponent(cid)}/gradebook/columns`, { limit: 100, maxPages: 5, timeoutMs, retries }));
      } catch { columns = []; }
      sample("columns", columns[0]);
      // The course total ("externalGrade") is a final grade, not an assessment.
      const totalColumn = columns.find((c) => c.externalGrade === true) || null;
      columns = columns.filter((c) => c !== totalColumn);
      const columnById = new Map([...columns, ...(totalColumn ? [totalColumn] : [])].map((c) => [c.id, c]));
      const contentByColumnContentId = new Map();
      for (const rec of contentIndex.values()) {
        // columns reference content via contentId; index not strictly needed
        // since we join on IDs below, kept for clarity.
        void rec;
      }

      // Category titles (columns only carry category IDs) for classification.
      const categoryById = new Map();
      try {
        const cats = await U.pagedGet(origin, `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/gradebook/categories`, { limit: 100, maxPages: 2, timeoutMs, retries: 1 });
        for (const c of cats) if (c && c.id) categoryById.set(c.id, c.title || c.name || null);
      } catch { /* optional */ }
      for (const col of columns) {
        if (!col.gradebookCategory && categoryById.get(col.gradebookCategoryId)) col.gradebookCategory = { title: categoryById.get(col.gradebookCategoryId) };
      }
      for (const col of columns) {
        const grading = col.grading || {};
        const descR = U.extractRichText(col.description);
        per.assessments.push({
          course: cname, course_id: cid,
          title: col.name || col.displayName || "(graded item)",
          description: U.htmlToText(descR.text),
          due_date: U.normalizeTimestamp(grading.due || col.due || U.findKey(col, ["dueDate"])),
          available_from: U.normalizeTimestamp(grading.availableFrom || (col.availability && col.availability.start)),
          available_until: U.normalizeTimestamp(grading.availableUntil || (col.availability && col.availability.end)),
          submission_status: null, submitted_at: null,
          grade: null, possible: (col.score && col.score.possible) ?? null,
          percentage: null, feedback: null, attempts: [],
          type: M.classifyAssessment({ column: col, content: col.contentId && contentIndex.get(col.contentId) }),
          content_id: col.contentId || null,
          column_id: col.id,
          calendar_id: null, attempt_id: null,
          gradebook_category: (col.gradebookCategory && (col.gradebookCategory.title || col.gradebookCategory.name)) || col.gradebookCategoryId || null,
          url: contentUrl(origin, cid, col.contentId || col.id),
          source_id: col.id,
          source: "gradebook-column"
        });
      }

      // Content-side assessment candidates (proven heuristic, kept) with IDs.
      for (const rec of contentIndex.values()) {
        const h = rec.handler || "";
        if (/assess|assign|test|survey|grade/i.test(h)) {
          per.assessments.push({
            course: cname, course_id: cid,
            title: rec.title,
            description: rec.description,
            due_date: (rec.dates && rec.dates.due) || null,
            available_from: rec.available_from || (rec.dates && rec.dates.start) || null,
            available_until: rec.available_until || (rec.dates && rec.dates.end) || null,
            submission_status: null, submitted_at: null,
            grade: null, possible: null, percentage: null, feedback: null, attempts: [],
            type: M.classifyAssessment({ column: { name: rec.title }, content: { contentHandler: { id: h } } }),
            content_id: rec.content_id,
            column_id: null, calendar_id: null, attempt_id: null,
            url: rec.url, source_id: rec.content_id,
            source: "content"
          });
        }
      }

      // 3e. grades — documented student-readable paths ONLY.
      // Primary: GET /learn/api/public/v1/courses/{courseId}/gradebook/users/{userId}
      // Fallback: per-column GET .../columns/{columnId}/users/{userId} (bounded).
      // The `/users/{uid}/grades` path (no /gradebook/) 404s and is never called.
      const gradeByColumn = new Map();
      let userGrades = [];
      try {
        const g = await track(`usergrades:${cid}`, "GET /learn/api/public/v1/courses/{id}/gradebook/users/{userId}",
          () => U.getJson(origin, `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/gradebook/users/${encodeURIComponent(myUserId)}?limit=100`, { timeoutMs, retries }));
        userGrades = g.results || g.grades || (g.columnId ? [g] : []);
      } catch {
        // Bounded per-column fallback (documented path).
        const todo = [...(totalColumn ? [totalColumn] : []), ...columns.slice(0, 10)]; // total first so the cap cannot drop the final grade
        const res = await U.limitedMap(todo, 2, async (col) => {
          const t0 = Date.now();
          try {
            const one = await U.getJson(origin, `/learn/api/public/v1/courses/${encodeURIComponent(cid)}/gradebook/columns/${encodeURIComponent(col.id)}/users/${encodeURIComponent(myUserId)}`, { timeoutMs, retries: 1 });
            recordSource(`grade:${cid}:${col.id}`, "GET .../columns/{columnId}/users/{userId}", "ok", 1, Date.now() - t0);
            return one;
          } catch (e) {
            // 403 = hidden from students (normal); 404 = no grade yet. Quiet.
            recordSource(`grade:${cid}:${col.id}`, "GET .../columns/{columnId}/users/{userId}", e && e.status ? `http_${e.status}` : "failed", 0, Date.now() - t0, e);
            return null;
          }
        }, true);
        for (const r of res) {
          if (r.ok && r.value && (r.value.columnId || r.value.status)) userGrades.push(r.value);
        }
      }
      sample("grades", userGrades[0]);
      for (const gr of userGrades) {
        if (!gr || typeof gr !== "object") continue;
        if (totalColumn && gr.columnId === totalColumn.id) {
          const score = typeof gr.score === "number" ? gr.score : (gr.displayGrade && gr.displayGrade.score) ?? null;
          const possible = (gr.displayGrade && gr.displayGrade.possible) ?? (totalColumn.score && totalColumn.score.possible) ?? null;
          course.final_grade = { score, possible, percentage: percentageOf(score, possible), text: (gr.displayGrade && gr.displayGrade.text) ?? null };
          continue;
        }
        const col = columnById.get(gr.columnId) || {};
        const score = typeof gr.score === "number" ? gr.score : (gr.displayGrade && gr.displayGrade.score) ?? null;
        const possible = (gr.displayGrade && gr.displayGrade.possible) ?? col.score?.possible ?? null;
        const fb = U.extractRichText(gr.feedback);
        per.grades.push({
          course: cname, course_id: cid,
          item: col.name || col.displayName || gr.columnId || "(grade)",
          column_id: gr.columnId || null,
          score, possible,
          percentage: percentageOf(score, possible),
          grade: (gr.displayGrade && gr.displayGrade.text) ?? gr.text ?? null,
          status: gr.status || null,
          submission_status: gr.status || null,
          feedback: U.htmlToText(fb.text),
          feedback_html: fb.html || (typeof gr.feedback === "string" ? gr.feedback : null),
          posted: U.normalizeTimestamp(gr.modified || gr.created),
          attempts: [],
          url: contentUrl(origin, cid, col.contentId || gr.columnId || cid),
          source_id: gr.columnId ? `grade:${cid}:${gr.columnId}` : null
        });
        if (gr.columnId) gradeByColumn.set(gr.columnId, gr);
      }

      // 3f. attempts (bounded): submission status + submitted timestamp.
      const assessed = per.assessments.filter((a) => a.column_id).slice(0, 10);
      await U.limitedMap(assessed, 2, async (a) => {
        try {
          const att = await U.getJson(origin, `/learn/api/public/v2/courses/${encodeURIComponent(cid)}/gradebook/columns/${encodeURIComponent(a.column_id)}/users/${encodeURIComponent(myUserId)}/attempts?limit=5`, { timeoutMs, retries: 1 });
          const list = att.results || att.attempts || [];
          if (list.length) {
            const last = list[list.length - 1];
            a.attempts = list.map((x) => ({
              id: x.id || null,
              status: x.status || null,
              created: U.normalizeTimestamp(x.created),
              modified: U.normalizeTimestamp(x.modified),
              submitted_at: U.normalizeTimestamp(x.modified || x.created),
              feedback: U.extractRichText(x.feedback).text
            }));
            a.submission_status = last.status || "Submitted";
            a.submitted_at = U.normalizeTimestamp(last.modified || last.created);
            a.attempt_id = last.id || null;
          }
        } catch { /* not attempt-based; skip quietly */ }
      }, true);

      // Back-fill assessment grade fields from grades.
      for (const a of per.assessments) {
        if (!a.column_id) continue;
        const gr = gradeByColumn.get(a.column_id);
        if (gr) {
          a.submission_status = a.submission_status || gr.status || null;
          const score = typeof gr.score === "number" ? gr.score : (gr.displayGrade && gr.displayGrade.score) ?? null;
          const possible = (gr.displayGrade && gr.displayGrade.possible) ?? a.possible ?? null;
          a.possible = possible;
          a.grade = (gr.displayGrade && gr.displayGrade.text) ?? gr.text ?? a.grade;
          a.percentage = percentageOf(score, possible);
          a.feedback = a.feedback || U.extractRichText(gr.feedback).text;
        }
      }

      // 3g. structured calendar sweep per course, in <= 16-week windows (longer -> HTTP 400).
      for (const w of windows) {
        try {
          const cal = await track(`calendar:${cid}`, "GET /learn/api/public/v1/calendars/items",
            () => U.getJson(origin, `/learn/api/public/v1/calendars/items?courseId=${encodeURIComponent(cid)}&since=${encodeURIComponent(w.since)}&until=${encodeURIComponent(w.until)}`, { timeoutMs, retries }));
          sample("calendar", (cal.results || [])[0]);
          for (const it of (cal.results || [])) {
            const dynId = it.dynamicCalendarItemProps && it.dynamicCalendarItemProps.id;
            per.events.push({
              title: it.title || "(event)",
              course: cname, course_id: cid,
              description: U.extractRichText(it.description).text,
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

      return per;
    }, true);

    for (const r of results) {
      if (!r.ok) continue; // per-course isolation: failure recorded by track(); export continues
      assessments.push(...r.value.assessments);
      announcements.push(...r.value.announcements);
      grades.push(...r.value.grades);
      events.push(...r.value.events);
      content.push(...r.value.content);
    }

    // ---- 4. global calendar sweep (kept) ----
    for (const w of windows) {
      try {
        const g = await track("calendar-global", "GET /learn/api/public/v1/calendars/items",
          () => U.getJson(origin, `/learn/api/public/v1/calendars/items?since=${encodeURIComponent(w.since)}&until=${encodeURIComponent(w.until)}`, { timeoutMs, retries }));
        for (const it of (g.results || [])) {
          const cid = it.calendarId || it.courseId || null;
          const cname = it.calendarName || (cid && courseById.get(cid)?.name) || null;
          events.push({
            title: it.title || "(event)", course: cname, course_id: cid,
            description: U.extractRichText(it.description).text,
            start: U.normalizeTimestamp(it.start),
            end: U.normalizeTimestamp(it.end),
            due_date: U.normalizeTimestamp(it.end || it.start),
            type: it.type || null, calendar_id: it.id || null, uid: it.id || null,
            url: cid ? courseUrl(origin, cid) : null,
            source_id: it.id ? `cal:${it.id}` : null,
            source: "api-calendar"
          });
        }
      } catch { /* recorded */ }
    }

    // ---- 5. ICS merge (kept as fallback/supplement) ----
    if (Array.isArray(options.icsEvents)) {
      for (const e of options.icsEvents) {
        events.push({
          title: e.title || e._raw_summary || "(event)",
          course: e.course || null, course_id: null,
          description: e.description || null,
          start: U.normalizeTimestamp(e.start),
          end: U.normalizeTimestamp(e.end),
          due_date: U.normalizeTimestamp(e.due_date || e.start),
          type: "ics", calendar_id: null,
          uid: e.source_id ? String(e.source_id).replace(/^ics:/, "") : (e.uid || null),
          url: e.url || null, source_id: e.source_id || null, source: "ics"
        });
      }
    }

    // ---- 6. ID-stable dedupe/merge (titles alone NEVER merge) ----
    const assessmentsM = M.mergeAssessments(assessments);
    const nowMs = Date.now();
    for (const a of assessmentsM) Object.assign(a, M.deadlineFlags(a, nowMs));
    const announcementsD = dedupeByKey(announcements, (a) => a.source_id || a.announcement_id || null);
    const gradesD = dedupeByKey(grades, (g) => g.source_id || (g.column_id ? `grade:${g.course_id}:${g.column_id}` : null));
    const eventsD = dedupeByKey(events, (e) => e.source_id || (e.uid ? `uid:${e.uid}` : null));
    const contentD = dedupeByKey(content, (m) => m.source_id || m.content_id || null);
    for (const c of courses) {
      c.grade_summary = M.gradeSummary(gradesD.filter((g) => g.course_id === c.id), assessmentsM.filter((a) => a.course_id === c.id));
    }

    // Backward-compatible aliases for the previous schema.
    const assignmentsAlias = assessmentsM.map((a) => ({
      course: a.course, course_id: a.course_id, title: a.title,
      description: a.description, due_date: a.due_date,
      submission_status: a.submission_status, grade: a.grade,
      possible: a.possible, url: a.url, source_id: a.source_id,
      content_id: a.content_id, column_id: a.column_id, attempt_id: a.attempt_id,
      type: a.type,
      is_upcoming: a.is_upcoming, is_overdue: a.is_overdue
    }));
    const materialsAlias = contentD;

    // Probe misses and 403s on closed courses are expected, not failures.
    const failedSources = sources.filter((s) => s.status !== "ok" && s.status !== "skipped" && s.status !== "forbidden" && !String(s.status).startsWith("probe_"));
    const summary = {
      courses_total: courses.length,
      courses_current: courses.filter((c) => c.is_current).length,
      courses_in_scope: inScope.length,
      scope,
      assessments: assessmentsM.length,
      announcements: announcementsD.length,
      grades: gradesD.length,
      events: eventsD.length,
      content: contentD.length,
      upcoming_deadlines: assessmentsM.filter((a) => a.is_upcoming).length,
      overdue: assessmentsM.filter((a) => a.is_overdue).length,
      failed_sources: failedSources.length,
      elapsed_ms: Date.now() - startedAt,
      ...(scopedNote ? { note: scopedNote } : {})
    };

    let out = {
      exported_at: nowISO(),
      source: "IAU Blackboard",
      origin,
      user: me ? { id: me.id, userName: me.userName || null } : null,
      courses: scope === "all" ? courses : inScope,
      assessments: assessmentsM.filter((a) => scope === "all" || (courseById.get(a.course_id)?.is_current ?? true)),
      assignments: assignmentsAlias.filter((a) => scope === "all" || (courseById.get(a.course_id)?.is_current ?? true)),
      announcements: announcementsD.filter((a) => scope === "all" || (courseById.get(a.course_id)?.is_current ?? true)),
      grades: gradesD.filter((g) => scope === "all" || (courseById.get(g.course_id)?.is_current ?? true)),
      events: eventsD,
      content: contentD.filter((m) => scope === "all" || (courseById.get(m.course_id)?.is_current ?? true)),
      materials: materialsAlias.filter((m) => scope === "all" || (courseById.get(m.course_id)?.is_current ?? true)),
      diagnostics: {
        ...diagnostics,
        ...(samples ? { samples } : {}),
        sources,
        failed_sources: failedSources.map((s) => `${s.source}: ${s.status}${s.error ? ` (${s.error})` : ""}`),
        summary,
        known_bad_paths_skipped: KNOWN_BAD_GRADE_PATHS
      },
      summary
    };

    if (wantRedact) out = M.redactExport(out);
    return out;
  }

  const api = { extractAll, DEFAULT_ORIGIN, KNOWN_BAD_GRADE_PATHS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.BBExtractor = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
