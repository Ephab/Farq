"""Headless Blackboard session for the student's own sync (docs/blackboard-threat-model.md).

Signs in through IAU's AD FS form, runs the BB-Extension extractor inside the logged-in page, and
downloads chosen attachments into memory. The AD FS form submit is the only non-GET request.
The password is typed into the form and never logged, returned or stored here.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol
from urllib.parse import urlsplit

from .files import MAX_FILE_BYTES, Attachment

ORIGIN = "https://vle.iau.edu.sa"
LOGIN_URL = f"{ORIGIN}/auth-saml/saml/login?apId=_179_1&redirectUrl=https%3A%2F%2Fvle.iau.edu.sa%2Fultra"
EXTRACTOR_FILES = ("bb-utils.js", "bb-model.js", "extractor.js")
# IAU AD FS sign-in (iauauth.iau.edu.sa/adfs/ls). The one place to update if the page changes.
SELECTORS = {"username": "#userNameInput", "password": "#passwordInput", "submit": "#submitButton", "error": "#errorText"}
LOGIN_WAIT_MS = 30_000
EXTRACT_TIMEOUT_MS = 8 * 60_000
# The whole attachment phase; with login and extraction this keeps a sync under ~10 minutes.
DOWNLOAD_BUDGET_SECONDS = 180
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

    def __init__(self, code: str, detail: str = "", screenshot: bytes | None = None):
        super().__init__(code)
        self.code = code
        # What IAU showed instead of Blackboard (page title + host/path, no query string) and a
        # screenshot of it, so the student can see the extra step. Never contains the password.
        self.detail = detail
        self.screenshot = screenshot


class ExtractFailure(Exception):
    pass


@dataclass
class BrowserResult:
    export: dict
    session_state: dict
    files: dict[str, tuple[str, bytes]] = field(default_factory=dict)
    # True only when this run submitted the AD FS form and the sign-in succeeded. A saved session or a
    # silent AD FS cookie sign-in never checks the typed password, so it must not be remembered then.
    password_verified: bool = False


class BlackboardBrowser(Protocol):
    def run(self, *, username: str, password: str | None, session_state: dict | None,
            pick_attachments: Callable[[dict], list[Attachment]],
            progress: Callable[[str, str], None]) -> BrowserResult: ...


def headed_from_env() -> bool:
    """WAYPOINT_BB_HEADED=1 shows the sign-in window so the student can watch it (debugging)."""
    return os.getenv("WAYPOINT_BB_HEADED", "").strip().lower() in {"1", "true", "yes"}


def describe_page(url: str, title: str) -> str:
    """'<title> — <host><path>': where the sign-in stopped, without the query (SAMLRequest, tokens)."""
    parts = urlsplit(url or "")
    where = f"{parts.netloc}{parts.path}"
    return " — ".join(part for part in ((title or "").strip()[:100], where) if part)[:200]


def classify_after_submit(url: str, error_text: str | None, origin: str = ORIGIN) -> str:
    """'ok' once back on Ultra; 'bad_password' when AD FS shows an error; otherwise IAU asked for more."""
    if url.startswith(f"{origin}/ultra"):
        return "ok"
    if error_text and error_text.strip():
        return "bad_password"
    return "extra_verification"


def desktop_user_agent(version: str) -> str:
    """The user agent desktop Chrome of this version sends (headless Chromium says "HeadlessChrome")."""
    return (f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{version} Safari/537.36")


class PlaywrightBrowser:
    def __init__(self, origin: str = ORIGIN, login_url: str = LOGIN_URL, bundle_dir: Path | None = None,
                 headless: bool | None = None, login_wait_ms: int = LOGIN_WAIT_MS,
                 download_budget_s: float = DOWNLOAD_BUDGET_SECONDS):
        self.origin = origin.rstrip("/")
        self.login_url = login_url
        self.bundle_dir = bundle_dir or extractor_dir()
        self.headless = (not headed_from_env()) if headless is None else headless
        self.login_wait_ms = login_wait_ms
        self.download_budget_s = download_budget_s

    def run(self, *, username, password, session_state, pick_attachments, progress) -> BrowserResult:
        """Must be called from a worker thread, not the asyncio event-loop thread (Playwright sync API)."""
        try:
            from playwright.sync_api import Error as PlaywrightError, sync_playwright
        except ImportError as exc:
            raise LoginFailure("browser_missing") from exc
        try:
            bundle = [(self.bundle_dir / name).read_text(encoding="utf-8") for name in EXTRACTOR_FILES]
        except OSError:
            raise ExtractFailure("extract failed") from None
        with sync_playwright() as pw:
            try:
                chromium = pw.chromium.launch(headless=self.headless)
            except PlaywrightError as exc:
                raise LoginFailure("browser_missing") from exc
            try:
                # IAU's firewall blocks the AD FS page for a "HeadlessChrome" user agent, so present as plain Chrome.
                options = {"user_agent": desktop_user_agent(chromium.version)}
                if session_state:
                    options["storage_state"] = session_state
                context = chromium.new_context(**options)
                context.set_default_timeout(60_000)
                page = context.new_page()
                page.expose_function("waypointProgress", lambda message: progress("extracting", str(message)[:200]))
                progress("logging_in", "")
                verified = False
                if session_state and self._signed_in(context):
                    page.goto(f"{self.origin}/ultra/course", wait_until="domcontentloaded")
                else:
                    if not password:
                        raise LoginFailure("needs_login")
                    submitted = self._login(page, username, password)
                    verified = submitted
                # Blackboard can reach Ultra before acknowledging its single-session notice.
                # It is a known acknowledgement, not an MFA or consent challenge.
                self._dismiss_session_notice(page)
                if not self._signed_in(context):
                    raise self._extra_step(page)
                progress("extracting", "")
                try:
                    for source in bundle:
                        # Shadow `module` so the files register browser globals even if the page defines one.
                        page.evaluate(f"() => {{ const module = undefined; {source}\n}}")
                    outcome = page.evaluate(EXTRACT_SCRIPT, {"origin": self.origin, "timeoutMs": EXTRACT_TIMEOUT_MS})
                except PlaywrightError:
                    raise ExtractFailure("extract failed") from None
                if not outcome.get("ok"):
                    raise ExtractFailure(outcome.get("error") or "extract failed")
                export = outcome["data"]
                progress("reading_files", "")
                downloaded: dict[str, tuple[str, bytes]] = {}
                deadline = time.monotonic() + self.download_budget_s
                for attachment in pick_attachments(export):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break  # budget spent: keep what was downloaded, start nothing new
                    if not attachment.url.startswith(f"{self.origin}/"):
                        continue  # URLs come from the page world; never start a fetch on another origin.
                    try:
                        response = context.request.get(attachment.url, timeout=max(1_000, min(60_000, remaining * 1000)))
                    except PlaywrightError:
                        continue
                    if response.ok and self._allowed_final_url(response.url):
                        body = response.body()
                        if len(body) <= MAX_FILE_BYTES:
                            downloaded[attachment.key] = (attachment.name, body)
                return BrowserResult(export=export, session_state=context.storage_state(), files=downloaded,
                                     password_verified=verified)
            except PlaywrightError:
                raise LoginFailure("unreachable") from None
            finally:
                try:
                    chromium.close()
                except Exception:
                    pass

    def _extra_step(self, page) -> LoginFailure:
        """Record what IAU showed instead of Blackboard; best effort, never masks the failure."""
        detail, shot = "", None
        try:
            detail = describe_page(page.url, page.title())
            shot = page.screenshot(full_page=True, timeout=5_000)
        except Exception:
            pass
        return LoginFailure("extra_verification", detail, shot)

    def _dismiss_session_notice(self, page) -> bool:
        """Acknowledge only IAU's exact 'Additional device logged out' notice."""
        from playwright.sync_api import TimeoutError as PlaywrightTimeout
        if urlsplit(page.url).netloc != urlsplit(self.origin).netloc:
            return False
        heading = page.get_by_text("Additional device logged out", exact=True)
        try:
            heading.wait_for(state="visible", timeout=min(self.login_wait_ms, 5_000))
            notice = heading.locator("xpath=ancestor::*[.//button[normalize-space(.)='Continue']][1]")
            if not notice.count() or "You are permitted to only have 1 active session" not in notice.inner_text():
                return False
            notice.get_by_role("button", name="Continue", exact=True).click()
            heading.wait_for(state="hidden", timeout=5_000)
            return True
        except PlaywrightTimeout:
            return False

    def _allowed_final_url(self, url: str) -> bool:
        """Redirects are followed; keep the body only if the last hop is the Blackboard origin or https."""
        return url.startswith(f"{self.origin}/") or url.startswith("https://")

    def _signed_in(self, context) -> bool:
        response = context.request.get(f"{self.origin}/learn/api/v1/users/me",
                                       headers={"Accept": "application/json"}, max_redirects=0)
        return response.status == 200

    def _login(self, page, username: str, password: str) -> bool:
        """True when the form was submitted and accepted; False when AD FS signed in silently (cookie)."""
        from playwright.sync_api import TimeoutError as PlaywrightTimeout
        page.goto(self.login_url, wait_until="domcontentloaded")
        if page.url.startswith(f"{self.origin}/ultra"):
            return False
        try:
            # AD FS cookies may redirect asynchronously to Ultra after DOMContentLoaded.
            # Wait for either outcome rather than misreporting a missing login form.
            page.wait_for_function("({selector, origin}) => !!document.querySelector(selector) || location.href.startsWith(origin + '/ultra')",
                                   arg={"selector": SELECTORS["username"], "origin": self.origin},
                                   timeout=self.login_wait_ms)
        except PlaywrightTimeout:
            raise self._extra_step(page) from None
        if page.url.startswith(f"{self.origin}/ultra"):
            return False
        page.fill(SELECTORS["username"], username)
        page.fill(SELECTORS["password"], password)
        page.click(SELECTORS["submit"])
        try:
            page.wait_for_url(re.compile("^" + re.escape(self.origin) + "/ultra"), timeout=self.login_wait_ms)
        except PlaywrightTimeout:
            error = page.locator(SELECTORS["error"])
            text = error.first.inner_text(timeout=2_000) if error.count() else ""
            code = classify_after_submit(page.url, text, self.origin)
            raise (self._extra_step(page) if code == "extra_verification" else LoginFailure(code)) from None
        return True
