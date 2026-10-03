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
from app.models import BlackboardContentItem, BlackboardCourse, BlackboardGrade, EvidenceItem, Student  # noqa: E402
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
    # Two sections of Deep Learning collapse to one; the completed course carries its grade.
    assert titles == ["Deep Learning", "Machine learning"]
    assert all(e.status == "suggested" for e in evidence)
    completed = next(e for e in evidence if e.title == "Machine learning")
    assert json.loads(completed.data_json)["grade"] == "B+"
    assert first.new_evidence == 2
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
