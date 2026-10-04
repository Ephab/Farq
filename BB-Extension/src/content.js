/* Content script: exposes a message API for the popup and logs readiness.
 * All extraction logic lives in extractor.js (BBExtractor) + ics.js (BB_ICS).
 * Read-only: only GET fetches, triggered explicitly by the user.
 */
(function () {
  if (typeof BBExtractor === "undefined" || typeof BBUtils === "undefined" || typeof BBModel === "undefined") {
    console.warn("[IAU BB Extractor] core scripts not loaded (bb-utils/bb-model/extractor)");
    return;
  }
  console.log("[IAU BB Extractor] ready on", location.origin, "- open the extension popup and click Extract.");

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "BB_EXTRACT") {
      BBExtractor.extractAll({
        origin: location.origin,
        icsEvents: msg.icsEvents || [],
        scope: msg.scope || "current",
        redact: !!msg.redact
      })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
      return true; // async response
    }
    if (msg && msg.type === "BB_PING") {
      sendResponse({ ok: true, origin: location.origin });
    }
  });
})();
