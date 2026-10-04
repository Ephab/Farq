/* BB shared utilities: safe HTML/text, rich-text extraction, timestamps, fetch helpers.
 * No Blackboard-specific endpoint paths here. Works in browser content scripts and Node.
 * Read-only helpers only; never stores credentials.
 */
(function (global) {
  "use strict";

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // Extract usable text/HTML from Blackboard rich-text fields, which may be a
  // string OR an object (BbML payloads). Never returns "[object Object]".
  // Returns { text, html } where html is the original markup when identifiable.
  function extractRichText(value) {
    if (value == null) return { text: null, html: null };
    if (typeof value === "string") {
      const s = value.trim();
      return { text: s || null, html: looksLikeHtml(s) ? s : null };
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const r = extractRichText(item);
        if (r.text) return r;
      }
      return { text: null, html: null };
    }
    if (isPlainObject(value)) {
      // Collect plain text AND markup separately: Blackboard objects often
      // carry both (e.g. { rawText: "...", displayText: "<p>...</p>" }).
      let text = null;
      let html = null;
      for (const k of ["rawText", "plainText", "displayText", "text", "message", "value", "content", "html", "body"]) {
        if (value[k] == null) continue;
        const r = extractRichText(value[k]);
        if (!r.text) continue;
        if (!text) text = r.text;
        if (!html && r.html) html = r.html;
        else if (!html && typeof value[k] === "string" && looksLikeHtml(value[k])) html = value[k];
        if (text && html) break;
      }
      if (text) return { text, html };
      // Last resort: first string-valued property (avoids String(obj)).
      for (const k of Object.keys(value)) {
        if (typeof value[k] === "string" && value[k].trim()) {
          const s = value[k].trim();
          return { text: s, html: looksLikeHtml(s) ? s : null };
        }
      }
      return { text: null, html: null };
    }
    // Numbers/booleans: stringify safely (never an object).
    return { text: String(value), html: null };
  }

  function looksLikeHtml(s) {
    return typeof s === "string" && /<[a-z][\s\S]*>/i.test(s);
  }

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
      // DOMParser builds an inert document: course HTML cannot trigger image or other loads.
      if (typeof DOMParser !== "undefined") {
        const body = new DOMParser().parseFromString(marked, "text/html").body;
        raw = (body && body.textContent) || "";
      } else if (typeof document !== "undefined" && document.createElement) {
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

  // Normalize timestamps to ISO 8601 UTC with millis. Preserves the instant;
  // does not invent a timezone. Returns null when unparseable.
  function normalizeTimestamp(value) {
    if (value == null) return null;
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isNaN(t) ? null : value.toISOString();
    }
    if (typeof value === "number") {
      // Heuristic: seconds vs millis.
      const ms = value < 1e12 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return null;
      // YYYYMMDDTHHMMSSZ (ICS basic format, possibly without Z)
      let m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
      // YYYYMMDD (ICS DATE)
      m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isTransientStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
  }

  // GET with timeout + retries for transient failures (429/5xx, timeouts).
  // Never logs or returns request headers/cookies.
  async function getJson(origin, path, opts = {}) {
    const timeoutMs = opts.timeoutMs || 20000;
    const retries = opts.retries != null ? opts.retries : 2;
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(origin + path, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: ctrl.signal
        });
        if (!res.ok) {
          const err = new Error(`GET ${path} -> HTTP ${res.status}`);
          err.status = res.status;
          if (isTransientStatus(res.status) && attempt < retries) {
            lastError = err;
            await sleep(Math.min(1000 * 2 ** attempt, 5000));
            continue;
          }
          throw err;
        }
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("json")) return await res.json();
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`GET ${path} returned non-JSON`);
        }
      } catch (e) {
        if (e && e.name === "AbortError" && attempt < retries) {
          lastError = new Error(`GET ${path} timed out`);
          await sleep(Math.min(1000 * 2 ** attempt, 5000));
          continue;
        }
        if (e && e.status && !isTransientStatus(e.status)) throw e;
        if (attempt >= retries) throw e;
        lastError = e;
        await sleep(Math.min(1000 * 2 ** attempt, 5000));
      } finally {
        clearTimeout(t);
      }
    }
    throw lastError || new Error(`GET ${path} failed`);
  }

  async function pagedGet(origin, pathTemplate, opts = {}) {
    const limit = opts.limit || 100;
    const maxPages = opts.maxPages || 10;
    const out = [];
    let offset = 0;
    let nextPath = null;
    for (let page = 0; page < maxPages; page++) {
      const sep = pathTemplate.includes("?") ? "&" : "?";
      const path = nextPath || `${pathTemplate}${sep}limit=${limit}&offset=${offset}`;
      const data = await getJson(origin, path, opts);
      const results = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
      out.push(...results);
      if (!data.paging || !data.paging.nextPage) break;
      offset += results.length || limit;
      if (typeof data.paging.nextPage === "string") {
        const nextUrl = new URL(data.paging.nextPage, origin + path);
        if (nextUrl.origin !== new URL(origin).origin) throw new Error("Refusing off-origin pagination");
        nextPath = nextUrl.pathname + nextUrl.search;
      }
      if (page === maxPages - 1) Object.defineProperty(out, "truncated", { value: true });
    }
    return out;
  }

  // Concurrency-limited map. Resolves to results in input order.
  // fn receives (item, index). Rejections propagate as {ok:false} when
  // collectErrors is true, so one course never aborts the export.
  async function limitedMap(items, limit, fn, collectErrors) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = { ok: true, value: await fn(items[i], i) };
        } catch (e) {
          if (!collectErrors) throw e;
          results[i] = { ok: false, error: e };
        }
      }
    }
    const workers = [];
    for (let w = 0; w < Math.max(1, Math.min(limit, items.length)); w++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  // Strip anything credential-like from an error for diagnostics.
  function sanitizeError(e) {
    const msg = String((e && e.message) || e || "unknown error").slice(0, 300);
    return msg
      .replace(/(BbRouter|JSESSIONID|session_id|authenti?cation|authorization|cookie|token|secret|password)[^\s;]*/gi, "$1=[redacted]");
  }

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

  const api = {
    extractRichText, htmlToText, normalizeTimestamp, getJson, pagedGet,
    limitedMap, sanitizeError, isTransientStatus, sleep, calendarWindows, findKey
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.BBUtils = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
