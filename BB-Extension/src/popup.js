/* Popup controller: asks the content script to run BBExtractor.extractAll().
 * If an ICS URL is pasted, fetches it (token URL, no cookies needed) and merges.
 * Never asks for username/password. Never sends cookies anywhere but Blackboard.
 */
let lastData = null;

const statusEl = document.getElementById("status");
const extractBtn = document.getElementById("extract");
const downloadBtn = document.getElementById("download");
const icsEl = document.getElementById("ics");
const redactEl = document.getElementById("redact");

function scope() {
  const el = document.querySelector('input[name="scope"]:checked');
  return el ? el.value : "current";
}

function setStatus(s) { statusEl.textContent = s; }

async function fetchICS(url) {
  const res = await fetch(url.trim(), { method: "GET", credentials: "omit" });
  if (!res.ok) throw new Error(`ICS fetch -> HTTP ${res.status}`);
  return await res.text();
}

function parseICSInPopup(icsText) {
  const lines = icsText.replace(/\r\n/g, "\n").split("\n");
  const unfolded = [];
  for (const ln of lines) {
    if ((ln.startsWith(" ") || ln.startsWith("\t")) && unfolded.length) unfolded[unfolded.length - 1] += ln.slice(1);
    else unfolded.push(ln);
  }
  const events = [];
  let cur = null;
  const unesc = (s) => s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  const dt = (v) => {
    if (!v) return null;
    let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
    m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  for (const line of unfolded) {
    const u = line.toUpperCase();
    if (u === "BEGIN:VEVENT") { cur = {}; continue; }
    if (u === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const name = line.slice(0, ci).split(";")[0].toUpperCase();
    const val = line.slice(ci + 1);
    if (name === "UID") { cur.source_id = "ics:" + val; cur.uid = val; }
    else if (name === "SUMMARY") { cur.title = unesc(val); cur._summary = unesc(val); }
    else if (name === "DESCRIPTION") cur.description = unesc(val);
    else if (name === "LOCATION") cur.location = unesc(val);
    else if (name === "DTSTART") cur.start = dt(val);
    else if (name === "DTEND") cur.end = dt(val);
    else if (name === "DUE") cur.due_date = dt(val);
    else if (name === "URL") cur.url = val;
  }
  return events.map((e) => {
    let course = null, title = e.title || "(no title)";
    const m = (e._summary || "").match(/^(.{3,}?):\s+(.{3,})$/);
    if (m) { course = m[1].trim(); title = m[2].trim(); }
    return { title, course, start: e.start || null, end: e.end || null, due_date: e.due_date || e.start || null, description: e.description || null, url: e.url || null, source_id: e.source_id || null, uid: e.uid || null };
  });
}

function renderSummary(n) {
  const s = n.summary || {};
  const lines = [
    `Courses:       ${(s.courses_current != null ? s.courses_current + " current / " : "") + (n.courses ? n.courses.length : 0) + " in export"} (${s.courses_total != null ? s.courses_total + " total" : "? total"}, scope=${s.scope || scope()})`,
    `Assessments:   ${(n.assessments || []).length}`,
    `Announcements: ${(n.announcements || []).length}`,
    `Grades:        ${(n.grades || []).length}`,
    `Events:        ${(n.events || []).length}`,
    `Content:       ${(n.content || []).length}`,
    "",
    "Failed sources:",
    ...(((n.diagnostics && n.diagnostics.failed_sources) || []).length
      ? n.diagnostics.failed_sources.map((f) => `* ${f}`)
      : ["(none)"]),
    "",
    "Click Download JSON."
  ];
  setStatus(lines.join("\n"));
}

extractBtn.addEventListener("click", async () => {
  setStatus("Starting… make sure the active tab is vle.iau.edu.sa and logged in.");
  extractBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/vle\.iau\.edu\.sa\//.test(tab.url || "")) {
      throw new Error("Active tab is not vle.iau.edu.sa. Open Blackboard Ultra in this browser first.");
    }
    let icsEvents = [];
    const icsUrl = (icsEl.value || "").trim();
    if (icsUrl) {
      setStatus("Fetching ICS feed…");
      const text = await fetchICS(icsUrl);
      icsEvents = parseICSInPopup(text);
      setStatus(`ICS: ${icsEvents.length} events. Now extracting Blackboard…`);
    }
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "BB_EXTRACT", icsEvents, scope: scope(), redact: !!redactEl.checked });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || "No response from page. Reload the Blackboard tab and retry.");
    lastData = resp.data;
    downloadBtn.disabled = false;
    renderSummary(lastData);
  } catch (e) {
    setStatus("Error: " + e.message);
  } finally {
    extractBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!lastData) return;
  const blob = new Blob([JSON.stringify(lastData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `iau-blackboard-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
