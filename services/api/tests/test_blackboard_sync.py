import copy
import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-bbsync-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["BLACKBOARD_SYNC_ENABLED"] = "false"

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import BlackboardAttachment, BlackboardContentItem, BlackboardCourse, BlackboardGrade, EvidenceItem, Student  # noqa: E402
from app.blackboard_sync import ingest  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "blackboard-export-sample.json"
SYLLABUS_KEY = "_101_1:_file1:_att9"


def sample() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    try:
        TEST_DB.unlink(missing_ok=True)
    except PermissionError:
        pass  # store_evidence's background observer may still hold the file on Windows


@pytest.fixture()
def student(client):
    sid = f"bb-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    db.add(Student(id=sid, display_name="BB Student"))
    db.commit()
    db.close()
    return sid


def ingest_sample(sid: str, export: dict | None = None, texts: dict | None = None):
    db = SessionLocal()
    try:
        result = ingest.ingest_export(db, sid, export or sample(), texts or {})
        db.commit()
        return result
    finally:
        db.close()


def rows(model, **where):
    db = SessionLocal()
    try:
        query = select(model)
        for key, value in where.items():
            query = query.where(getattr(model, key) == value)
        return db.scalars(query).all()
    finally:
        db.close()


def test_plain_strips_html_and_entities():
    assert ingest.plain("<h5>QUIZ</h5><p>A &amp; B</p>") == "QUIZ\nA & B"
    assert ingest.plain(None) == ""


def test_course_label_drops_section_suffix():
    assert ingest.course_label("Deep Learning-7MA1") == "Deep Learning"
    assert ingest.course_label("Machine learning-6MA2") == "Machine learning"
    assert ingest.course_label("Ethics") == "Ethics"


def test_ingest_maps_courses_items_grades(student):
    result = ingest_sample(student, texts={SYLLABUS_KEY: "Midterm covers chapters 1-4."})
    courses = {c.external_id: c for c in rows(BlackboardCourse, student_id=student)}
    assert set(courses) == {"_101_1", "_102_1", "_090_1"}
    dl = courses["_101_1"]
    assert dl.source_kind == "blackboard_live" and dl.is_current and dl.term == "Fall 2026"
    assert json.loads(dl.instructors_json)[0]["name"] == "Sara Ali"
    assert json.loads(dl.grade_summary_json)["percentage"] == 90
    items = {i.external_id: i for i in rows(BlackboardContentItem, course_id=dl.id)}
    assert items["ann:_a1"].content_type == "announcement" and "Topics: Backprop" in items["ann:_a1"].body_text
    assert items["asmt:_col4"].content_type == "assignment" and items["asmt:_col4"].due_at is not None
    assert items["content:_file1"].content_type == "syllabus"
    assert "Midterm covers chapters 1-4." in items["content:_file1"].body_text
    assert items["content:_c1"].content_type == "lecture" and items["content:_c1"].body_text == "Hello & welcome"
    assert "content:_f1" not in items  # empty folder rows carry nothing useful
    grade = rows(BlackboardGrade, course_id=dl.id)[0]
    assert grade.score == 9 and grade.possible == 10 and grade.feedback == "Good work"
    assert result.courses == 3 and result.current_courses == 2
    assert result.upcoming_deadlines == 1 and result.overdue == 1 and result.files_read == 1


def test_ingest_suggests_course_evidence_once(student):
    first = ingest_sample(student)
    evidence = rows(EvidenceItem, student_id=student)
    titles = sorted(e.title for e in evidence)
    # Two sections collapse to one. A gradebook total alone never proves completion.
    assert titles == ["Deep Learning"]
    assert all(e.status == "suggested" for e in evidence)
    assert first.new_evidence == 1
    assert ingest_sample(student).new_evidence == 0


def test_dismissed_evidence_not_resurrected(student):
    ingest_sample(student)
    db = SessionLocal()
    for e in db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student)).all():
        e.status = "dismissed"
    db.commit()
    db.close()
    ingest_sample(student)
    assert {e.status for e in rows(EvidenceItem, student_id=student)} == {"dismissed"}


def test_first_live_sync_replaces_demo_rows(student):
    db = SessionLocal()
    demo = BlackboardCourse(student_id=student, external_id="ARTI-404", title="Demo", source_kind="blackboard_demo")
    db.add(demo)
    db.commit()
    db.close()
    ingest_sample(student)
    assert "ARTI-404" not in {c.external_id for c in rows(BlackboardCourse, student_id=student)}


def test_empty_export_keeps_existing_rows(student):
    ingest_sample(student)
    empty = sample()
    empty["courses"] = []
    with pytest.raises(ValueError):
        ingest_sample(student, empty)
    assert len(rows(BlackboardCourse, student_id=student)) == 3


def test_failed_source_keeps_old_items(student):
    ingest_sample(student)
    later = sample()
    later["announcements"] = []
    later["diagnostics"]["sources"] = [s for s in later["diagnostics"]["sources"] if s["source"] != "announcements:_101_1"]
    later["diagnostics"]["sources"].append({"source": "announcements:_101_1", "status": "http_500"})
    ingest_sample(student, later)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    assert any(i.external_id == "ann:_a1" for i in rows(BlackboardContentItem, course_id=course.id))


def test_removed_item_deleted_when_source_ok(student):
    ingest_sample(student)
    later = sample()
    later["announcements"] = []
    ingest_sample(student, later)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    assert not any(i.external_id == "ann:_a1" for i in rows(BlackboardContentItem, course_id=course.id))


def test_unchanged_item_keeps_modified_at(student):
    ingest_sample(student)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    before = {i.external_id: i.modified_at for i in rows(BlackboardContentItem, course_id=course.id)}
    ingest_sample(student)
    after = {i.external_id: i.modified_at for i in rows(BlackboardContentItem, course_id=course.id)}
    assert before["asmt:_col4"] == after["asmt:_col4"]



def test_unread_attachment_keeps_earlier_text_until_removed(student):
    def syllabus_body():
        course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
        item = next(i for i in rows(BlackboardContentItem, course_id=course.id) if i.external_id == "content:_file1")
        return item.body_text

    ingest_sample(student, texts={SYLLABUS_KEY: "Midterm covers chapters 1-4."})
    ingest_sample(student, texts={})
    assert "Midterm covers chapters 1-4." in syllabus_body()
    removed = sample()
    next(c for c in removed["content"] if c["content_id"] == "_file1")["attachments"] = []
    ingest_sample(student, removed, texts={})
    assert "Midterm covers chapters 1-4." not in syllabus_body()


def with_source(export: dict, name: str, status: str) -> dict:
    """The export with exactly one diagnostics entry for `name`, at `status`."""
    sources = [s for s in export["diagnostics"]["sources"] if s["source"] != name]
    export["diagnostics"]["sources"] = sources + [{"source": name, "status": status}]
    return export


def course_items(sid: str, ext: str = "_101_1") -> dict:
    course = next(c for c in rows(BlackboardCourse, student_id=sid) if c.external_id == ext)
    return {i.external_id: i for i in rows(BlackboardContentItem, course_id=course.id)}


def test_partial_contents_keeps_items_missing_from_export(student):
    ingest_sample(student)
    later = with_source(sample(), "contents:_101_1", "partial")  # a folder's children request failed
    later["content"] = [c for c in later["content"] if c["content_id"] != "_file1"]
    ingest_sample(student, later)
    assert "content:_file1" in course_items(student)


def test_ok_contents_deletes_items_missing_from_export(student):
    ingest_sample(student)
    later = sample()
    later["content"] = [c for c in later["content"] if c["content_id"] != "_file1"]
    ingest_sample(student, later)
    assert "content:_file1" not in course_items(student)


def test_course_missing_from_export_is_deleted(student):
    ingest_sample(student)
    later = sample()
    later["courses"] = [c for c in later["courses"] if c["id"] != "_102_1"]
    ingest_sample(student, later)
    assert {c.external_id for c in rows(BlackboardCourse, student_id=student)} == {"_101_1", "_090_1"}


def test_removed_grade_deleted_only_when_usergrades_ok(student):
    def grade_ids():
        course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
        return {g.external_id for g in rows(BlackboardGrade, course_id=course.id)}

    ingest_sample(student)
    assert grade_ids() == {"_col1"}
    failed = with_source(sample(), "usergrades:_101_1", "http_500")
    failed["grades"] = []
    ingest_sample(student, failed)
    assert grade_ids() == {"_col1"}  # grades could not be read: keep the old ones
    removed = sample()
    removed["grades"] = []
    ingest_sample(student, removed)
    assert grade_ids() == set()


def test_partial_attachment_listing_keeps_earlier_file_text(student):
    ingest_sample(student, texts={SYLLABUS_KEY: "Midterm covers chapters 1-4."})
    later = with_source(sample(), "attachments:_101_1", "partial")
    next(c for c in later["content"] if c["content_id"] == "_file1")["attachments"] = []  # listing failed
    ingest_sample(student, later, texts={})
    body = course_items(student)["content:_file1"].body_text
    assert "[File: Course Syllabus.pdf]\nMidterm covers chapters 1-4." in body
    assert body.count("[File: ") == 1


def test_assessment_grade_zero_is_shown(student):
    export = sample()
    next(a for a in export["assessments"] if a["source_id"] == "_col2").update(grade=0)
    ingest_sample(student, export)
    assert "Grade: 0 / 5" in course_items(student)["asmt:_col2"].body_text


def test_memberships_failure_suggests_no_course_evidence(student):
    export = with_source(sample(), "memberships", "http_500")
    export["diagnostics"]["sources"].append({"source": "courses-fallback", "status": "ok"})
    result = ingest_sample(student, export)
    assert result.new_evidence == 0 and rows(EvidenceItem, student_id=student) == []
    assert len(rows(BlackboardCourse, student_id=student)) == 3  # course data is still synced


import io  # noqa: E402

from cryptography.fernet import Fernet  # noqa: E402

from app.blackboard_sync import credentials, files  # noqa: E402
from app.models import BlackboardConnection  # noqa: E402


@pytest.fixture()
def fernet_key(monkeypatch):
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())


def test_password_and_session_are_sealed(fernet_key):
    conn = BlackboardConnection(student_id="s1", username="2240000000")
    credentials.remember_password(conn, "hunter2-secret")
    credentials.save_session(conn, {"cookies": [{"name": "BbRouter", "value": "abc"}]})
    assert "hunter2-secret" not in (conn.password_enc or "")
    assert "BbRouter" not in (conn.session_enc or "")
    assert credentials.saved_password(conn) == "hunter2-secret"
    assert credentials.saved_session(conn)["cookies"][0]["value"] == "abc"
    credentials.forget_password(conn)
    credentials.clear_session(conn)
    assert credentials.saved_password(conn) is None and credentials.saved_session(conn) is None


def test_without_key_password_is_not_remembered(monkeypatch):
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", "")
    assert credentials.can_remember() is False
    conn = BlackboardConnection(student_id="s-nokey", username="u")
    credentials.save_session(conn, {"cookies": []})
    assert conn.session_enc is None and credentials.saved_session(conn) == {"cookies": []}  # memory only
    credentials.clear_session(conn)


def test_rotated_key_reads_as_not_saved(fernet_key, monkeypatch):
    conn = BlackboardConnection(student_id="s2", username="u")
    credentials.remember_password(conn, "pw")
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    assert credentials.saved_password(conn) is None


def test_select_attachments_prefers_current_syllabus_and_caps():
    export = sample()
    picked = files.select_attachments(export)
    assert [a.key for a in picked] == [SYLLABUS_KEY]
    assert picked[0].url.endswith("/attachments/_att9/download")
    many = copy.deepcopy(export)
    base = many["content"][1]
    many["content"] = [dict(base, content_id=f"_x{i}", attachments=[dict(base["attachments"][0], id=f"_a{i}", name=f"f{i}.pdf")]) for i in range(90)]
    many["content"].append(dict(base, content_id="_big", attachments=[dict(base["attachments"][0], id="_big", size=files.MAX_FILE_BYTES + 1)]))
    many["content"].append(dict(base, content_id="_zip", attachments=[dict(base["attachments"][0], id="_zip", name="code.zip")]))
    chosen = files.select_attachments(many)
    assert len(chosen) == files.MAX_FILES
    assert not any(a.key.endswith(":_big") or a.key.endswith(":_zip") for a in chosen)


def test_extract_text_from_office_files_redacts_ids():
    from docx import Document
    from pptx import Presentation

    doc = Document()
    doc.add_paragraph("Midterm covers chapters 1-4. Contact 2240003321 for questions about grading policy.")
    buffer = io.BytesIO()
    doc.save(buffer)
    text = files.extract_text("Syllabus.docx", buffer.getvalue())
    assert "Midterm covers chapters 1-4." in text and "2240003321" not in text

    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[1])
    slide.shapes.title.text = "Backpropagation"
    slide.placeholders[1].text = "Chain rule applied layer by layer through the network graph."
    buffer = io.BytesIO()
    deck.save(buffer)
    assert "Chain rule" in files.extract_text("Lecture 3.pptx", buffer.getvalue())


def test_extract_text_rejects_garbage_and_oversize():
    assert files.extract_text("broken.pdf", b"%PDF-not-really") is None
    assert files.extract_text("archive.zip", b"PK...") is None
    assert files.extract_text("huge.txt", b"a" * (files.MAX_FILE_BYTES + 1)) is None
    long = files.extract_text("notes.txt", ("word " * 20_000).encode())
    assert long is not None and len(long) <= files.MAX_CHARS


def test_extract_text_rejects_zip_bombs():
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"\0" * (101 * 1024 * 1024))
    assert len(buffer.getvalue()) < files.MAX_FILE_BYTES
    assert files.extract_text("bomb.docx", buffer.getvalue()) is None
    assert files.extract_text("bomb.pptx", buffer.getvalue()) is None


import logging  # noqa: E402

from app.blackboard_sync import worker  # noqa: E402
from app.blackboard_sync.browser import BrowserResult, ExtractFailure, LoginFailure  # noqa: E402

SECRET = "S3cret-Pa55-word!"


class FakeBrowser:
    """Stands in for Chromium: plays back an outcome and records what it was asked."""
    calls: list[dict] = []
    outcome: object = None
    verifies: bool = True  # False: signed in via the saved session/AD FS cookie, form never submitted

    def run(self, *, username, password, session_state, pick_attachments, progress):
        FakeBrowser.calls.append({"username": username, "password": password, "session": session_state})
        progress("extracting", "Courses: 3")
        if isinstance(FakeBrowser.outcome, Exception):
            raise FakeBrowser.outcome
        export = sample()
        picks = pick_attachments(export)
        return BrowserResult(export=export, session_state={"cookies": [{"name": "BbRouter", "value": "x"}]},
                             password_verified=bool(password) and FakeBrowser.verifies,
                             # Text bytes under a .txt name: extract_text dispatches on the extension.
                             files={a.key: ("syllabus.txt", b"Syllabus: midterm covers chapters 1-4 and the final covers all.") for a in picks})


@pytest.fixture()
def fake_browser(monkeypatch, fernet_key):
    FakeBrowser.calls, FakeBrowser.outcome, FakeBrowser.verifies = [], None, True
    monkeypatch.setattr(worker, "browser_factory", FakeBrowser)
    real_start = worker.start
    monkeypatch.setattr(worker, "start", lambda sid, pw, remember, background=True: real_start(sid, pw, remember, background=False))
    return FakeBrowser


def sync(client, sid, **body):
    return client.post(f"/api/students/{sid}/blackboard/sync", json=body or None)


def test_first_sync_with_credentials(client, student, fake_browser):
    response = sync(client, student, username="2240000000", password=SECRET, remember=True)
    assert response.status_code == 202
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["status"] == "done" and status["has_saved_login"] is True
    assert status["summary"]["current_courses"] == 2 and status["summary"]["files_read"] == 1
    assert status["next_sync_at"] is not None
    assert fake_browser.calls[0]["password"] == SECRET


def test_resync_uses_saved_session_and_password(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    assert sync(client, student).status_code == 202
    second = fake_browser.calls[-1]
    assert second["password"] == SECRET and second["session"]["cookies"][0]["name"] == "BbRouter"


def test_remember_false_drops_password_keeps_session(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET, remember=False)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["has_saved_login"] is False and status["status"] == "done"
    sync(client, student)
    assert fake_browser.calls[-1]["password"] is None and fake_browser.calls[-1]["session"]


def test_password_never_in_responses_or_logs(client, student, fake_browser, caplog):
    caplog.set_level(logging.DEBUG)
    bodies = [sync(client, student, username="2240000000", password=SECRET, remember=True).text,
              client.get(f"/api/students/{student}/blackboard/sync").text]
    fake_browser.outcome = LoginFailure("bad_password")
    bodies.append(sync(client, student, username="2240000000", password=SECRET).text)
    bodies.append(client.get(f"/api/students/{student}/blackboard/sync").text)
    assert all(SECRET not in body for body in bodies)
    assert SECRET not in caplog.text


def test_overlong_password_not_echoed(client, student, fake_browser):
    response = sync(client, student, username="u", password=SECRET * 40)
    assert response.status_code == 422 and SECRET not in response.text


def test_saved_password_rejected_is_wiped_and_loop_stops(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    fake_browser.outcome = LoginFailure("bad_password")
    sync(client, student)  # periodic-style resync with the saved password
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["status"] == "failed" and status["failure_reason"] == "bad_password"
    assert status["has_saved_login"] is False and status["next_sync_at"] is None
    db = SessionLocal()
    assert student not in worker.due_students(db)
    db.close()


def test_three_typed_bad_passwords_wipe_everything(client, student, fake_browser):
    fake_browser.outcome = LoginFailure("bad_password")
    for _ in range(3):
        sync(client, student, username="2240000000", password="nope-nope")
    db = SessionLocal()
    conn = db.get(BlackboardConnection, student)
    assert conn.failed_logins == 3 and conn.password_enc is None and conn.session_enc is None
    db.close()


def test_unreachable_keeps_data_and_retries_later(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    fake_browser.outcome = LoginFailure("unreachable")
    sync(client, student)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["failure_reason"] == "unreachable" and status["next_sync_at"] is not None
    assert len(rows(BlackboardCourse, student_id=student)) == 3


def test_extract_failure_is_reported(client, student, fake_browser):
    fake_browser.outcome = ExtractFailure("Not logged into Blackboard")
    sync(client, student, username="2240000000", password=SECRET)
    assert client.get(f"/api/students/{student}/blackboard/sync").json()["failure_reason"] == "extract_failed"


def test_first_sync_needs_credentials(client, student, fake_browser):
    assert sync(client, student).status_code == 422  # no connection row and nothing sent
    assert sync(client, student, username="2240000000").status_code == 422


def test_no_saved_login_reports_needs_login_status(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET, remember=False)
    db = SessionLocal()
    credentials.clear_session(db.get(BlackboardConnection, student))
    db.commit()
    db.close()
    before = len(fake_browser.calls)
    response = sync(client, student)
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "failed" and body["failure_reason"] == "needs_login" and body["has_saved_login"] is False
    assert len(fake_browser.calls) == before  # nothing to sign in with: no browser run


def test_password_sealed_with_other_key_is_not_saved_login(client, student, fake_browser, monkeypatch):
    from app.blackboard_sync.routes import status_dict
    sync(client, student, username="2240000000", password=SECRET)
    monkeypatch.setenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    db = SessionLocal()
    conn = db.get(BlackboardConnection, student)
    assert conn.password_enc and status_dict(conn)["has_saved_login"] is False
    db.close()


def test_unverified_typed_password_is_not_remembered(client, student, fake_browser):
    fake_browser.verifies = False  # the saved session signed in; the typed password was never checked
    sync(client, student, username="2240000000", password="maybe-mistyped", remember=True)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["status"] == "done" and status["has_saved_login"] is False
    db = SessionLocal()
    assert db.get(BlackboardConnection, student).password_enc is None
    db.close()


def test_due_students_skips_disabled_connector(client, student, fake_browser):
    from datetime import timedelta
    from app.models import now
    from app.student_memory import set_connector
    sync(client, student, username="2240000000", password=SECRET)
    db = SessionLocal()
    db.get(BlackboardConnection, student).next_sync_at = now() - timedelta(minutes=1)
    db.commit()
    assert student in worker.due_students(db)
    set_connector(db, student, "blackboard", False)
    db.commit()
    assert student not in worker.due_students(db)
    db.close()


def test_second_post_while_running_is_single_flight(client, student, fake_browser, monkeypatch):
    sync(client, student, username="2240000000", password=SECRET)
    monkeypatch.setattr(worker, "_running", {student})
    before = len(fake_browser.calls)
    response = sync(client, student)
    assert response.status_code == 202 and len(fake_browser.calls) == before


def test_connector_switch_blocks_sync(client, student, fake_browser):
    from app.student_memory import set_connector
    db = SessionLocal()
    set_connector(db, student, "blackboard", False)
    db.commit()
    db.close()
    assert sync(client, student, username="2240000000", password=SECRET).status_code == 409


def test_forget_wipes_login(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    assert client.delete(f"/api/students/{student}/blackboard/connection").json() == {"forgotten": True}
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["connected"] is False and status["has_saved_login"] is False
    assert len(rows(BlackboardCourse, student_id=student)) == 3  # synced course data stays


def test_other_student_cannot_read_status(client, student, fake_browser):
    other = client.post("/api/students", json={"display_name": "Intruder"}).json()["student_id"]
    response = client.get(f"/api/students/{student}/blackboard/sync", headers={"X-Waypoint-User": other, "x-test-no-auto": "1"})
    assert response.status_code in {403, 404}


def test_deadlines_endpoint_lists_upcoming_current(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    items = client.get(f"/api/students/{student}/blackboard/deadlines").json()["items"]
    assert [i["title"] for i in items] == ["Project report"]
    assert items[0]["course"] == "Deep Learning-7MA1" and items[0]["overdue"] is False


def test_reset_interrupted_marks_running_rows_failed(client, student):
    db = SessionLocal()
    db.add(BlackboardConnection(student_id=student, username="u", status="extracting"))
    db.commit()
    worker.reset_interrupted(db)
    assert db.get(BlackboardConnection, student).failure_reason == "interrupted"
    db.close()


def test_post_with_credentials_while_running_is_rejected_untouched(client, student, fake_browser, monkeypatch):
    sync(client, student, username="2240000000", password=SECRET)
    monkeypatch.setattr(worker, "_running", {student})
    response = sync(client, student, username="someone-else", password="other-pass")
    assert response.status_code == 409 and "other-pass" not in response.text
    db = SessionLocal()
    conn = db.get(BlackboardConnection, student)
    assert conn.username == "2240000000" and credentials.saved_password(conn) == SECRET
    db.close()


def test_deadlines_exclude_needs_grading_status(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    db = SessionLocal()
    item = db.scalars(select(BlackboardContentItem).join(BlackboardCourse, BlackboardContentItem.course_id == BlackboardCourse.id)
                      .where(BlackboardCourse.student_id == student, BlackboardContentItem.title == "Project report")).first()
    item.body_text = "Brief\nStatus: needs_grading"
    db.commit()
    db.close()
    assert client.get(f"/api/students/{student}/blackboard/deadlines").json()["items"] == []


def test_deadlines_list_in_progress_draft(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    db = SessionLocal()
    item = db.scalars(select(BlackboardContentItem).join(BlackboardCourse, BlackboardContentItem.course_id == BlackboardCourse.id)
                      .where(BlackboardCourse.student_id == student, BlackboardContentItem.title == "Project report")).first()
    item.body_text = "Brief\nStatus: InProgress"
    db.commit()
    db.close()
    items = client.get(f"/api/students/{student}/blackboard/deadlines").json()["items"]
    assert [i["title"] for i in items] == ["Project report"]


def test_crash_sets_retry_time(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    fake_browser.outcome = RuntimeError("boom")
    sync(client, student)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["failure_reason"] == "extract_failed" and status["next_sync_at"] is not None


def test_hermes_list_courses_exposes_live_fields(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    from app.blackboard import _course_dict
    db = SessionLocal()
    course = db.scalar(select(BlackboardCourse).where(BlackboardCourse.student_id == student, BlackboardCourse.external_id == "_101_1"))
    data = _course_dict(course)
    db.close()
    assert data["is_current"] is True and data["instructors"][0]["name"] == "Sara Ali"
    assert data["grade_summary"]["percentage"] == 90 and data["url"].endswith("/outline")


def test_status_reports_live_mode(client, student, fake_browser):
    sync(client, student, username="2240000000", password=SECRET)
    status = client.get(f"/api/students/{student}/blackboard/status").json()
    assert status["mode"] == "live" and status["courses"] == 3 and status["last_synced_at"]


def test_extra_step_detail_and_screenshot_reach_the_owner(client, student, fake_browser, monkeypatch, tmp_path):
    monkeypatch.setenv("WAYPOINT_BB_DEBUG_DIR", str(tmp_path))
    fake_browser.outcome = LoginFailure("extra_verification", "Update your password — iauauth.iau.edu.sa/adfs/ls/", b"PNG-fake")
    sync(client, student, username="2240000000", password=SECRET)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["failure_reason"] == "extra_verification"
    assert status["stage_detail"] == "Update your password — iauauth.iau.edu.sa/adfs/ls/"
    assert status["has_screenshot"] is True
    shot = client.get(f"/api/students/{student}/blackboard/sync/screenshot")
    assert shot.status_code == 200 and shot.content == b"PNG-fake"
    assert SECRET not in shot.text and SECRET not in json.dumps(status)
    client.delete(f"/api/students/{student}/blackboard/connection")
    assert client.get(f"/api/students/{student}/blackboard/sync/screenshot").status_code == 404


def test_next_sync_clears_old_screenshot(client, student, fake_browser, monkeypatch, tmp_path):
    monkeypatch.setenv("WAYPOINT_BB_DEBUG_DIR", str(tmp_path))
    fake_browser.outcome = LoginFailure("extra_verification", "Verify — host/path", b"png")
    sync(client, student, username="2240000000", password=SECRET)
    fake_browser.outcome = None
    sync(client, student, username="2240000000", password=SECRET)
    status = client.get(f"/api/students/{student}/blackboard/sync").json()
    assert status["status"] == "done" and status["has_screenshot"] is False and status["stage_detail"] == ""


def test_file_catalog_preserves_all_files_without_bytes(student):
    export = sample()
    base = export["content"][1]
    base["attachments"] += [{"id": f"_slide{i}", "name": f"Lecture {i}.pptx", "download_url": f"https://vle.iau.edu.sa/bbcswebdav/lecture{i}.pptx"} for i in range(100)]
    export["courses"][0].update(term_id="_fall", course_status="current", term_start="2026-08-01", term_end="2026-12-31")
    result = ingest_sample(student, export)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    files = rows(BlackboardAttachment, course_id=course.id)
    assert len(files) == result.files == 101
    assert all(not a.text_indexed for a in files)
    assert course.term_id == "_fall" and course.lifecycle == "current"
    assert json.loads(course.metadata_json)["term_end"] == "2026-12-31"


def test_file_catalog_partial_listing_keeps_missing_files(student):
    ingest_sample(student)
    later = with_source(sample(), "attachments:_101_1", "partial")
    later["content"][1]["attachments"] = []
    ingest_sample(student, later)
    course = next(c for c in rows(BlackboardCourse, student_id=student) if c.external_id == "_101_1")
    assert len(rows(BlackboardAttachment, course_id=course.id)) == 1
    with_source(later, "attachments:_101_1", "ok")
    ingest_sample(student, later)
    assert rows(BlackboardAttachment, course_id=course.id) == []


def test_filtered_export_does_not_delete_past_courses(student):
    ingest_sample(student)
    later = sample()
    later["summary"]["scope"] = "current"
    later["courses"] = later["courses"][:1]
    ingest_sample(student, later)
    assert len(rows(BlackboardCourse, student_id=student)) == 3


def test_completion_needs_explicit_blackboard_status():
    export = sample()
    assert len(ingest.course_evidence(export["courses"])) == 1
    export["courses"][-1]["course_status"] = "completed"
    completed = next(e for e in ingest.course_evidence(export["courses"]) if e.title == "Machine learning")
    assert completed.data["grade"] == "B+"


def test_collection_exposes_all_courses_files_grades_and_redacted_snapshot(client, student, fake_browser, monkeypatch):
    export = sample()
    export["user"] = {"userName": "PRIVATE-USER"}
    export["events"] = [{"title": "Office hours", "description": "Call 2240003321 or person@iau.edu.sa"}]
    monkeypatch.setattr(__name__ + ".sample", lambda: export)
    sync(client, student, username="2240000000", password=SECRET)
    response = client.get(f"/api/students/{student}/blackboard/collection")
    assert response.status_code == 200
    data = response.json()
    assert len(data["courses"]) == 3 and data["has_file_catalog"]
    assert sum(len(c["files"]) for c in data["courses"]) == 1
    assert sum(len(c["grades"]) for c in data["courses"]) == 1
    assert "PRIVATE-USER" not in response.text and "2240003321" not in response.text and "person@iau.edu.sa" not in response.text
    assert SECRET not in response.text
    assert data["events"][0]["description"] == "Call [id] or [email]"
    other = client.post("/api/students", json={"display_name": "Intruder"}).json()["student_id"]
    assert client.get(f"/api/students/{student}/blackboard/collection", headers={"X-Waypoint-User": other}).status_code == 403


def test_on_demand_download_is_owner_only_uncached_and_checks_connector(client, student, fake_browser, monkeypatch):
    from app.blackboard_sync import catalog
    sync(client, student, username="2240000000", password=SECRET)
    files = client.get(f"/api/students/{student}/blackboard/slides").json()["files"]
    assert len(files) == 1 and "download_url" not in files[0]
    path = f"/api/students/{student}/blackboard/files/{files[0]['id']}/download"
    calls = []
    monkeypatch.setattr(catalog, "download_bytes", lambda url, state: calls.append(url) or b"%PDF-TEST")
    other = client.post("/api/students", json={"display_name": "Intruder"}).json()["student_id"]
    assert client.get(path, headers={"X-Waypoint-User": other}).status_code == 403
    assert calls == []
    response = client.get(path)
    assert response.content == b"%PDF-TEST" and response.headers["cache-control"] == "no-store"
    assert "filename*=UTF-8" in response.headers["content-disposition"]
    monkeypatch.setattr(catalog, "disabled_connectors", lambda db, sid: ["blackboard"])
    assert client.get(path).status_code == 409 and len(calls) == 1


def test_download_rejects_untrusted_url_before_using_session():
    from app.blackboard_sync.catalog import download_bytes
    from fastapi import HTTPException
    for url in ["http://vle.iau.edu.sa/file.pdf", "https://evil.example/file.pdf", "https://vle.iau.edu.sa.evil.example/file.pdf"]:
        with pytest.raises(HTTPException) as error:
            download_bytes(url, {"cookies": []})
        assert error.value.status_code == 422


@pytest.mark.parametrize("status,headers,expected", [
    (302, {"location": "https://evil.example/file.pdf"}, 409),
    (200, {"content-type": "text/html"}, 409),
    (403, {}, 409),
    (200, {"content-length": str(16 * 1024 * 1024)}, 413),
])
def test_download_checks_redirects_expired_sessions_and_sizes(monkeypatch, status, headers, expected):
    from contextlib import contextmanager
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.blackboard_sync.catalog import download_bytes
    import playwright.sync_api
    calls, body_reads = [], []
    response = SimpleNamespace(status=status, headers=headers, ok=status == 200, body=lambda: body_reads.append(True) or b"file")
    def get(url, **options):
        calls.append((url, options))
        return response
    request = SimpleNamespace(get=get, dispose=lambda: None)
    @contextmanager
    def fake_playwright():
        yield SimpleNamespace(request=SimpleNamespace(new_context=lambda **opts: request))
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", fake_playwright)
    with pytest.raises(HTTPException) as error:
        download_bytes("https://vle.iau.edu.sa/file.pdf", {"cookies": []})
    assert error.value.status_code == expected and len(calls) == 1
    assert calls[0][1]["max_redirects"] == 0 and body_reads == []


def test_iau_storage_redirect_downloads_without_forwarding_login_state(monkeypatch):
    from contextlib import contextmanager
    from types import SimpleNamespace
    from app.blackboard_sync.catalog import STORAGE_HOST, download_bytes
    import playwright.sync_api
    contexts, calls, disposed = [], [], []
    storage_url = f"https://{STORAGE_HOST}/signed-file.pdf?signature=test"
    def new_context(**options):
        contexts.append(options)
        index = len(contexts)
        def get(url, **kwargs):
            calls.append((url, kwargs))
            if index == 1:
                return SimpleNamespace(status=302, headers={"location": storage_url}, ok=False)
            return SimpleNamespace(status=200, headers={"content-type": "application/pdf"}, ok=True, body=lambda: b"%PDF-TEST")
        return SimpleNamespace(get=get, dispose=lambda: disposed.append(index))
    @contextmanager
    def fake_playwright():
        yield SimpleNamespace(request=SimpleNamespace(new_context=new_context))
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", fake_playwright)
    state = {"cookies": [{"name": "BbRouter", "value": "PRIVATE", "domain": "vle.iau.edu.sa"}]}
    assert download_bytes("https://vle.iau.edu.sa/file.pdf", state) == b"%PDF-TEST"
    assert contexts == [{"storage_state": state}, {}]
    assert [c[0] for c in calls] == ["https://vle.iau.edu.sa/file.pdf", storage_url]
    assert all(c[1]["max_redirects"] == 0 for c in calls) and sorted(disposed) == [1, 2]


def test_file_host_allowlist_is_exact_and_storage_cannot_start_download():
    from app.blackboard_sync.catalog import STORAGE_HOST, allowed_file_url
    assert allowed_file_url(f"https://{STORAGE_HOST}/file.pdf")
    assert not allowed_file_url(f"https://{STORAGE_HOST}/file.pdf", initial=True)
    for url in [f"http://{STORAGE_HOST}/file.pdf", f"https://{STORAGE_HOST}.evil.example/file.pdf",
                "https://other.blackboard.com/file.pdf", f"https://{STORAGE_HOST}:8443/file.pdf",
                f"https://user:password@{STORAGE_HOST}/file.pdf"]:
        assert not allowed_file_url(url)
