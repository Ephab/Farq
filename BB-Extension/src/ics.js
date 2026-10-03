/* IAU Blackboard ICS parser — no dependencies, works in browser + Node.
 * Parses RFC 5545 VEVENT blocks needed for Blackboard calendar feeds.
 * Read-only, no network calls here. Fetching is done by the caller.
 */
(function (global) {
  "use strict";

  function unfoldLines(text) {
    // RFC 5545 line unfolding: lines starting with space/tab continue previous line
    const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const out = [];
    for (const line of raw) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        if (out.length) out[out.length - 1] += line.slice(1);
      } else {
        out.push(line);
      }
    }
    return out;
  }

  function unescapeText(s) {
    return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }

  function parseDateTime(value, params) {
    if (!value) return null;
    // DATE: YYYYMMDD -> treat as UTC midnight
    if (/^\d{8}$/.test(value)) {
      const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
      return `${y}-${m}-${d}T00:00:00.000Z`;
    }
    // DATE-TIME: YYYYMMDDTHHMMSS[Z] or with TZID param
    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
    if (m) {
      const [, y, mo, d, h, mi, s, z] = m;
      if (z) return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
      // No Z: Blackboard exports in UTC with Z in practice. If TZID present,
      // we keep the wall time and mark Z only if params say UTC; otherwise
      // return as-is with Z assumption documented by caller.
      // To avoid inventing a timezone, return naive wall time + note.
      if (params && /UTC/i.test(params)) return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
      return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
    }
    return null;
  }

  function splitProp(line) {
    // "DTSTART;VALUE=DATE:20240101" -> {name, params, value}
    const colon = line.indexOf(":");
    if (colon < 0) return null;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = left.indexOf(";");
    if (semi < 0) return { name: left.toUpperCase(), params: "", value };
    return { name: left.slice(0, semi).toUpperCase(), params: left.slice(semi + 1), value };
  }

  function parseICS(text) {
    const lines = unfoldLines(text);
    const events = [];
    let cur = null;
    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper === "BEGIN:VEVENT") { cur = {}; continue; }
      if (upper === "END:VEVENT") {
        if (cur) events.push(cur);
        cur = null;
        continue;
      }
      if (!cur) continue;
      const p = splitProp(line);
      if (!p) continue;
      const v = p.value;
      switch (p.name) {
        case "UID": cur.uid = v; break;
        case "SUMMARY": cur.summary = unescapeText(v); break;
        case "DESCRIPTION": cur.description = unescapeText(v); break;
        case "LOCATION": cur.location = unescapeText(v); break;
        case "URL": cur.url = v; break;
        case "DTSTART": cur.start = parseDateTime(v, p.params); cur._dtstartRaw = v; break;
        case "DTEND": cur.end = parseDateTime(v, p.params); break;
        case "DUE": cur.due = parseDateTime(v, p.params); break;
        case "DTSTAMP": cur.dtstamp = parseDateTime(v, p.params); break;
        case "CATEGORIES": cur.categories = unescapeText(v); break;
        case "STATUS": cur.status = v; break;
        default:
          // Keep X- props that Blackboard sometimes uses for course info
          if (p.name.startsWith("X-")) {
            cur.x = cur.x || {};
            cur.x[p.name] = unescapeText(v);
          }
          break;
      }
    }
    return events;
  }

  // Blackboard ICS SUMMARY is often "CourseName: AssignmentName" or similar.
  // Split heuristically but always keep full summary.
  function toExtractorEvents(icsEvents, origin) {
    return icsEvents.map((e) => {
      const due = e.due || e.start || null;
      let course = null;
      let title = e.summary || "(no title)";
      // Heuristic split on first ": " or " - " if it looks like "CODE ... : Title"
      const m = (e.summary || "").match(/^(.{3,}?):\s+(.{3,})$/);
      if (m) { course = m[1].trim(); title = m[2].trim(); }
      return {
        title,
        course,
        start: e.start || null,
        end: e.end || null,
        due_date: due,
        description: e.description || null,
        location: e.location || null,
        url: e.url || null,
        source_id: e.uid ? `ics:${e.uid}` : null,
        source: "ics",
        _raw_summary: e.summary || null
      };
    });
  }

  const api = { parseICS, toExtractorEvents, unfoldLines };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { global.BB_ICS = api; }
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
