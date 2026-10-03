/* Test entry point: syntax checks + unit tests + mocked end-to-end extract.
 * No live IAU account required. Run: node test/run-tests.js
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failures++; }
  else console.log("PASS:", msg);
}

// 1. ICS sample fixture (kept from v1).
const ics = require("../src/ics.js");
const text = fs.readFileSync(path.join(__dirname, "sample.ics"), "utf8");
const events = ics.parseICS(text);
assert(events.length === 3, `parseICS finds 3 VEVENTs (got ${events.length})`);
assert(events[0].uid === "cal-001@vle.iau.edu.sa", "UID parsed");
assert(events[0].start === "2026-02-10T20:59:00.000Z", "DTSTART UTC kept");
const mapped = ics.toExtractorEvents(events);
assert(mapped[0].source_id === "ics:cal-001@vle.iau.edu.sa", "source_id namespaced");

// 2. Syntax check every shipped JS file.
for (const f of ["../src/bb-utils.js", "../src/bb-model.js", "../src/ics.js", "../src/extractor.js", "../src/content.js", "../src/popup.js", "../tools/extract-console.js"]) {
  try {
    new (require("vm").Script)(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    assert(true, `${f} parses`);
  } catch (e) { assert(false, `${f} parses: ${e.message}`); }
}

// 3. Manifest loads utils before extractor; host scope stays IAU-only.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "MV3 manifest");
assert((manifest.host_permissions || []).some((h) => h.includes("vle.iau.edu.sa")), "host permission scoped to IAU");
const cs = (manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].js) || [];
assert(cs.indexOf("src/bb-utils.js") < cs.indexOf("src/extractor.js"), "content scripts load bb-utils before extractor");

// 4. .gitignore excludes export JSON (privacy).
const gi = fs.readFileSync(path.join(__dirname, "../.gitignore"), "utf8");
assert(/iau-blackboard-export-\*\.json/.test(gi), ".gitignore excludes export JSON");

// 4b. Console snippet is generated from src/ (no hand-maintained copy drifting).
const built = execFileSync(process.execPath, [path.join(__dirname, "../tools/build-console.js"), "--check"], { encoding: "utf8" });
assert(/up to date/.test(built), "tools/extract-console.js is generated from src/ and up to date");

// 5. Unit tests (rich text, timestamps, classification, filtering, dedupe, redaction, retries).
try {
  execFileSync(process.execPath, [path.join(__dirname, "unit-tests.js")], { stdio: "inherit" });
} catch { failures++; console.error("FAIL: unit-tests.js"); }

// 6. Mocked end-to-end extract (proves pipeline incl. scope + redact + no 404 path).
try {
  execFileSync(process.execPath, [path.join(__dirname, "mock-extract.js")], { stdio: "inherit" });
} catch { failures++; console.error("FAIL: mock-extract.js"); }

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll tests passed.");
