"""Headless Blackboard session for the student's own sync (docs/blackboard-threat-model.md).

Signs in through IAU's AD FS form, runs the BB-Extension extractor inside the logged-in page, and
downloads chosen attachments into memory. The AD FS form submit is the only non-GET request.
The password is typed into the form and never logged, returned or stored here.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from .files import MAX_FILE_BYTES, Attachment

ORIGIN = "https://vle.iau.edu.sa"
LOGIN_URL = f"{ORIGIN}/auth-saml/saml/login?apId=_179_1&redirectUrl=https%3A%2F%2Fvle.iau.edu.sa%2Fultra"
EXTRACTOR_FILES = ("bb-utils.js", "bb-model.js", "extractor.js")
# IAU AD FS sign-in (iauauth.iau.edu.sa/adfs/ls). The one place to update if the page changes.
SELECTORS = {"username": "#userNameInput", "password": "#passwordInput", "submit": "#submitButton", "error": "#errorText"}
LOGIN_WAIT_MS = 30_000
EXTRACT_TIMEOUT_MS = 8 * 60_000
EXTRACT_SCRIPT = """async ({ origin, timeoutMs }) => {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("extract timed out")), timeoutMs));
  try {
    const data = await Promise.race([
      BBExtractor.extractAll({ origin, scope: "all", onProgress: (m) => window.waypointProgress(String(m)) }),
      timeout,
    ]);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  }
}"""


def extractor_dir() -> Path:
    configured = os.getenv("WAYPOINT_BB_EXTRACTOR_DIR", "").strip()
    return Path(configured) if configured else Path(__file__).resolve().parents[4] / "BB-Extension" / "src"


class LoginFailure(Exception):
    """code: bad_password | extra_verification | unreachable | needs_login | browser_missing"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ExtractFailure(Exception):
    pass


@dataclass
class BrowserResult:
    export: dict
    session_state: dict
    files: dict[str, tuple[str, bytes]] = field(default_factory=dict)


class BlackboardBrowser(Protocol):
    def run(self, *, username: str, password: str | None, session_state: dict | None,
            pick_attachments: Callable[[dict], list[Attachment]],
            progress: Callable[[str, str], None]) -> BrowserResult: ...


def classify_after_submit(url: str, error_text: str | None, origin: str = ORIGIN) -> str:
    """'ok' once back on Ultra; 'bad_password' when AD FS shows an error; otherwise IAU asked for more."""
    if url.startswith(f"{origin}/ultra"):
        return "ok"
    if error_text and error_text.strip():
        return "bad_password"
    return "extra_verification"


class PlaywrightBrowser:
    def __init__(self, origin: str = ORIGIN, login_url: str = LOGIN_URL, bundle_dir: Path | None = None,
                 headless: bool = True, login_wait_ms: int = LOGIN_WAIT_MS):
        self.origin = origin.rstrip("/")
        self.login_url = login_url
        self.bundle_dir = bundle_dir or extractor_dir()
        self.headless = headless
        self.login_wait_ms = login_wait_ms

    def run(self, *, username, password, session_state, pick_attachments, progress) -> BrowserResult:
        try:
            from playwright.sync_api import Error as PlaywrightError, sync_playwright
        except ImportError as exc:
            raise LoginFailure("browser_missing") from exc
        bundle = [(self.bundle_dir / name).read_text(encoding="utf-8") for name in EXTRACTOR_FILES]
        with sync_playwright() as pw:
            try:
                chromium = pw.chromium.launch(headless=self.headless)
            except PlaywrightError as exc:
                raise LoginFailure("browser_missing") from exc
            try:
                context = chromium.new_context(storage_state=session_state) if session_state else chromium.new_context()
                context.set_default_timeout(60_000)
                page = context.new_page()
                page.expose_function("waypointProgress", lambda message: progress("extracting", str(message)[:200]))
                progress("logging_in", "")
                if session_state and self._signed_in(context):
                    page.goto(f"{self.origin}/ultra/course", wait_until="domcontentloaded")
                else:
                    if not password:
                        raise LoginFailure("needs_login")
                    self._login(page, username, password)
                    if not self._signed_in(context):
                        raise LoginFailure("extra_verification")
                progress("extracting", "")
                for source in bundle:
                    # Shadow `module` so the files register browser globals even if the page defines one.
                    page.evaluate(f"() => {{ const module = undefined; {source}\n}}")
                outcome = page.evaluate(EXTRACT_SCRIPT, {"origin": self.origin, "timeoutMs": EXTRACT_TIMEOUT_MS})
                if not outcome.get("ok"):
                    raise ExtractFailure(outcome.get("error") or "extract failed")
                export = outcome["data"]
                progress("reading_files", "")
                downloaded: dict[str, tuple[str, bytes]] = {}
                for attachment in pick_attachments(export):
                    try:
                        response = context.request.get(attachment.url, timeout=60_000)
                    except PlaywrightError:
                        continue
                    if response.ok:
                        body = response.body()
                        if len(body) <= MAX_FILE_BYTES:
                            downloaded[attachment.key] = (attachment.name, body)
                return BrowserResult(export=export, session_state=context.storage_state(), files=downloaded)
            except PlaywrightError as exc:
                raise LoginFailure("unreachable") from exc
            finally:
                chromium.close()

    def _signed_in(self, context) -> bool:
        response = context.request.get(f"{self.origin}/learn/api/v1/users/me",
                                       headers={"Accept": "application/json"}, max_redirects=0)
        return response.status == 200

    def _login(self, page, username: str, password: str) -> None:
        from playwright.sync_api import TimeoutError as PlaywrightTimeout
        page.goto(self.login_url, wait_until="domcontentloaded")
        if page.url.startswith(f"{self.origin}/ultra"):
            return
        try:
            page.wait_for_selector(SELECTORS["username"], timeout=self.login_wait_ms)
        except PlaywrightTimeout:
            raise LoginFailure("extra_verification") from None
        page.fill(SELECTORS["username"], username)
        page.fill(SELECTORS["password"], password)
        page.click(SELECTORS["submit"])
        try:
            page.wait_for_url(re.compile("^" + re.escape(self.origin) + "/ultra"), timeout=self.login_wait_ms)
        except PlaywrightTimeout:
            error = page.locator(SELECTORS["error"])
            text = error.first.inner_text(timeout=2_000) if error.count() else ""
            raise LoginFailure(classify_after_submit(page.url, text, self.origin)) from None
