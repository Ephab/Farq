"""Login classification, plus a fake IAU portal driven by real Chromium (skipped if not installed)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import pytest

from app.blackboard_sync import browser
from app.blackboard_sync.files import Attachment


def test_classify_after_submit():
    assert browser.classify_after_submit("https://vle.iau.edu.sa/ultra/course", None) == "ok"
    assert browser.classify_after_submit("https://iauauth.iau.edu.sa/adfs/ls/?x", "Incorrect user ID or password.") == "bad_password"
    assert browser.classify_after_submit("https://iauauth.iau.edu.sa/adfs/ls/mfa", "  ") == "extra_verification"


def test_extractor_dir_points_at_bb_extension(monkeypatch):
    monkeypatch.delenv("WAYPOINT_BB_EXTRACTOR_DIR", raising=False)
    assert (browser.extractor_dir() / "extractor.js").is_file()


PASSWORD = "correct-horse"
FORM = """<html><body><form method="post" action="/adfs/ls/">
<input id="userNameInput" name="u"><input id="passwordInput" name="p" type="password">
<span id="errorText">{error}</span><span id="submitButton" onclick="this.closest('form').submit()">Sign in</span>
</form></body></html>"""


class Portal(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep test output clean
        pass

    def _send(self, status, body=b"", ctype="text/html", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return "bb=1" in (self.headers.get("Cookie") or "")

    def do_GET(self):
        if self.path.startswith("/auth-saml/saml/login"):
            if "bb=silent" in (self.headers.get("Cookie") or ""):
                return self._send(200, b"<html><body><script>setTimeout(() => location.href='/ultra/course', 250)</script></body></html>")
            return self._send(302, headers={"Location": "/adfs/ls/"})
        if self.path.startswith("/adfs/ls/mfa"):
            return self._send(200, b"<html><head><title>Verify your identity</title></head><body>Approve the sign-in</body></html>")
        if self.path.startswith("/adfs/ls"):
            # Like IAU's firewall: a "HeadlessChrome" user agent gets a block page, not the form.
            if "Headless" in (self.headers.get("User-Agent") or ""):
                return self._send(200, b"<html><head><title>The URL you requested has been blocked</title></head></html>")
            return self._send(200, FORM.format(error="").encode())
        if self.path.startswith("/ultra"):
            if any(f"bb={value}" in (self.headers.get("Cookie") or "") for value in ("pending", "silent")):
                return self._send(200, b'''<html><body><div role="dialog">
                  <h2>Additional device logged out</h2>
                  <p>You are permitted to only have 1 active session and have been logged out from another device.</p>
                  <button onclick="document.cookie='bb=1; Path=/'; this.parentElement.remove()">Continue</button>
                </div></body></html>''')
            if "bb=consent" in (self.headers.get("Cookie") or ""):
                return self._send(200, b'''<html><body><div role="dialog"><h2>Accept new terms</h2>
                  <button onclick="document.cookie='bb=1; Path=/'; this.parentElement.remove()">Continue</button>
                </div></body></html>''')
            return self._send(200, b"<html><body>Ultra</body></html>") if self._authed() else self._send(302, headers={"Location": "/auth-saml/saml/login"})
        if self.path == "/learn/api/v1/users/me":
            return self._send(200, b'{"id":"_1_1"}', "application/json") if self._authed() else self._send(302, headers={"Location": "/auth-saml/saml/login"})
        if self.path == "/files/hop":  # same-origin redirect: allowed
            return self._send(302, headers={"Location": "/files/syllabus.txt"})
        if self.path == "/files/away":  # redirect off the origin to plain http: body must be dropped
            return self._send(302, headers={"Location": f"http://localhost:{self.server.server_port}/public/notes.txt"})
        if self.path == "/public/notes.txt":
            return self._send(200, b"Off-origin text that must never be kept.", "text/plain")
        if self.path == "/files/syllabus.txt":
            return self._send(200, b"Week 1 covers gradient descent." * 4, "text/plain") if self._authed() else self._send(403)
        return self._send(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(length).decode())
        if form.get("p") in (["needs-notice"], ["needs-consent"]):
            cookie = "pending" if form["p"] == ["needs-notice"] else "consent"
            return self._send(302, headers={"Location": "/ultra/course", "Set-Cookie": f"bb={cookie}; Path=/"})
        if form.get("p") == [PASSWORD]:
            return self._send(302, headers={"Location": "/ultra/course", "Set-Cookie": "bb=1; Path=/"})
        if form.get("p") == ["needs-mfa"]:
            return self._send(302, headers={"Location": "/adfs/ls/mfa?ctx=SECRETCTX"})
        return self._send(200, FORM.format(error="Incorrect user ID or password.").encode())


@pytest.fixture()
def portal(tmp_path):
    pytest.importorskip("playwright.sync_api")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Portal)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "bb-utils.js").write_text("window.BBUtils = {};", encoding="utf-8")
    (bundle / "bb-model.js").write_text("window.BBModel = {};", encoding="utf-8")
    (bundle / "extractor.js").write_text(
        "window.BBExtractor = { extractAll: async (o) => { o.onProgress('Courses: 1'); "
        "return { courses: [{ id: '_1' }], content: [], origin: o.origin }; } };", encoding="utf-8")
    yield origin, bundle
    server.shutdown()


def _make(origin, bundle):
    # Short login wait: the bad-password case would otherwise sit out the 30 s production timeout.
    return browser.PlaywrightBrowser(origin=origin, login_url=f"{origin}/auth-saml/saml/login?apId=_179_1",
                                     bundle_dir=bundle, login_wait_ms=3_000)


def _run(b, password, state=None, picks=None):
    stages = []
    try:
        result = b.run(username="2240000000", password=password, session_state=state,
                       pick_attachments=lambda export: picks or [], progress=lambda s, d: stages.append((s, d)))
    except browser.LoginFailure as failure:
        if failure.code == "browser_missing":
            pytest.skip("Chromium is not installed (python -m playwright install chromium)")
        raise
    return result, stages


def test_fake_portal_login_extract_and_download(portal):
    origin, bundle = portal
    pick = [Attachment("_1:_c:_a", "_1", "_c", "syllabus.txt", f"{origin}/files/syllabus.txt", 100)]
    result, stages = _run(_make(origin, bundle), PASSWORD, picks=pick)
    assert result.export["courses"][0]["id"] == "_1"
    assert result.files["_1:_c:_a"][0] == "syllabus.txt" and b"gradient descent" in result.files["_1:_c:_a"][1]
    assert any(c["name"] == "bb" for c in result.session_state["cookies"])
    assert ("extracting", "Courses: 1") in stages
    assert PASSWORD not in json.dumps(result.session_state)
    assert result.password_verified is True  # the form was submitted and accepted


def test_fake_portal_extra_step_reports_page_and_screenshot(portal):
    origin, bundle = portal
    with pytest.raises(browser.LoginFailure) as caught:
        _run(_make(origin, bundle), "needs-mfa")
    failure = caught.value
    assert failure.code == "extra_verification"
    assert failure.detail.startswith("Verify your identity — 127.0.0.1:") and failure.detail.endswith("/adfs/ls/mfa")
    assert "SECRETCTX" not in failure.detail and "needs-mfa" not in failure.detail
    assert failure.screenshot and failure.screenshot[1:4] == b"PNG"


def test_single_session_notice_is_acknowledged_before_api_check(portal):
    origin, bundle = portal
    result, _ = _run(_make(origin, bundle), "needs-notice")
    assert result.export["courses"] and result.password_verified
    assert any(c["name"] == "bb" and c["value"] == "1" for c in result.session_state["cookies"])


def test_other_continue_dialog_is_not_acknowledged(portal):
    origin, bundle = portal
    with pytest.raises(browser.LoginFailure) as caught:
        _run(_make(origin, bundle), "needs-consent")
    assert caught.value.code == "extra_verification"


def test_delayed_silent_signin_reaches_notice_without_waiting_for_form(portal):
    origin, bundle = portal
    state = {"cookies": [{"name": "bb", "value": "silent", "domain": "127.0.0.1", "path": "/"}], "origins": []}
    result, _ = _run(_make(origin, bundle), "not-verified", state=state)
    assert result.export["courses"] and result.password_verified is False


def test_describe_page_drops_query_and_fragment():
    assert browser.describe_page("https://iauauth.iau.edu.sa/adfs/ls/?SAMLRequest=abc#x", "Sign In") == "Sign In — iauauth.iau.edu.sa/adfs/ls/"
    assert browser.describe_page("", "") == ""


def test_headed_mode_from_env(monkeypatch):
    monkeypatch.setenv("WAYPOINT_BB_HEADED", "1")
    assert browser.PlaywrightBrowser().headless is False
    monkeypatch.delenv("WAYPOINT_BB_HEADED")
    assert browser.PlaywrightBrowser().headless is True


def test_fake_portal_bad_password(portal):
    origin, bundle = portal
    with pytest.raises(browser.LoginFailure) as caught:
        _run(_make(origin, bundle), "wrong")
    assert caught.value.code == "bad_password"


def test_saved_session_skips_login_and_missing_password_needs_login(portal):
    origin, bundle = portal
    first, _ = _run(_make(origin, bundle), PASSWORD)
    again, _ = _run(_make(origin, bundle), None, state=first.session_state)
    assert again.export["courses"] and again.password_verified is False
    # A typed (maybe mistyped) password is not verified when the saved session signs in.
    typed, _ = _run(_make(origin, bundle), "mistyped", state=first.session_state)
    assert typed.export["courses"] and typed.password_verified is False
    with pytest.raises(browser.LoginFailure) as caught:
        _run(_make(origin, bundle), None, state=None)
    assert caught.value.code == "needs_login"


def test_extractor_load_error_is_extract_failure(portal):
    origin, bundle = portal
    (bundle / "extractor.js").write_text('throw new Error("boom");', encoding="utf-8")
    with pytest.raises(browser.ExtractFailure):
        _run(_make(origin, bundle), PASSWORD)


def test_extractor_rejection_is_extract_failure(portal):
    origin, bundle = portal
    (bundle / "extractor.js").write_text(
        "window.BBExtractor = { extractAll: async () => { throw new Error('nope'); } };", encoding="utf-8")
    with pytest.raises(browser.ExtractFailure):
        _run(_make(origin, bundle), PASSWORD)


def test_missing_bundle_file_is_extract_failure(portal):
    origin, bundle = portal
    (bundle / "extractor.js").unlink()
    with pytest.raises(browser.ExtractFailure):
        _run(_make(origin, bundle), PASSWORD)


def test_other_origin_attachment_is_not_fetched(portal):
    origin, bundle = portal
    picks = [Attachment("k1", "_1", "_c", "x.txt", "http://127.0.0.1:1/x", 10),
             Attachment("k2", "_1", "_c", "syllabus.txt", f"{origin}/files/syllabus.txt", 100)]
    result, _ = _run(_make(origin, bundle), PASSWORD, picks=picks)
    assert "k1" not in result.files and "k2" in result.files


def test_redirect_off_origin_body_is_dropped(portal):
    origin, bundle = portal
    picks = [Attachment("hop", "_1", "_c", "syllabus.txt", f"{origin}/files/hop", 100),
             Attachment("away", "_1", "_c", "notes.txt", f"{origin}/files/away", 100)]
    result, _ = _run(_make(origin, bundle), PASSWORD, picks=picks)
    assert b"gradient descent" in result.files["hop"][1]
    assert "away" not in result.files


def test_download_budget_stops_new_downloads(portal):
    origin, bundle = portal
    b = _make(origin, bundle)
    b.download_budget_s = 0
    pick = [Attachment("_1:_c:_a", "_1", "_c", "syllabus.txt", f"{origin}/files/syllabus.txt", 100)]
    result, _ = _run(b, PASSWORD, picks=pick)
    assert result.export["courses"] and result.files == {}


def test_allowed_final_url():
    b = browser.PlaywrightBrowser()
    assert b._allowed_final_url("https://vle.iau.edu.sa/bbcswebdav/x.pdf")
    assert b._allowed_final_url("https://cdn.example.com/signed/x.pdf")
    assert not b._allowed_final_url("http://10.0.0.5/x.pdf")
    assert not b._allowed_final_url("file:///etc/passwd")
