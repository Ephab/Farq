"""Project setup import: extraction, review, and the batch proposal it produces."""
import io
import json

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.teams import imports

DOC = ("CS 490 Capstone. Problem: clinics lose paper records. Objective: build a booking app for clinics. "
       "Deliverables: SRS due 2026-10-20, final demo in week 14. Grading: requirements 40%, demo 60%. "
       "Contact the instructor at prof@example.edu.")

ROWS = {"rows": [
    {"kind": "brief", "data": {"problem": "Clinics lose paper records", "objective": "A booking app", "scope": "", "constraints": [], "tools": ["React"]},
     "source_quote": "Problem: clinics lose paper records.", "confidence": "stated"},
    {"kind": "deliverable", "data": {"key": "srs", "title": "Requirements spec", "due": "2026-10-20", "doc_kind": "srs"},
     "source_quote": "SRS due 2026-10-20", "confidence": "stated"},
    {"kind": "deliverable", "data": {"key": "demo", "title": "Final demo", "due": None, "due_text": "week 14", "doc_kind": None},
     "source_quote": "final demo in week 14", "confidence": "stated"},
    {"kind": "milestone", "data": {"title": "SRS submitted", "due": "2026-10-20", "deliverable_key": "srs"}, "source_quote": "SRS due", "confidence": "stated"},
    {"kind": "criterion", "data": {"name": "Requirements", "weight": 40}, "source_quote": "requirements 40%", "confidence": "stated"},
    {"kind": "criterion", "data": {"name": "Demo", "weight": 60}, "source_quote": "demo 60%", "confidence": "stated"},
    {"kind": "milestone", "data": {"title": ""}, "source_quote": "", "confidence": "stated"},  # dropped: no title
    {"kind": "grade_everyone_a", "data": {}},  # dropped: unknown kind
]}


@pytest.fixture
def fake_hermes(monkeypatch):
    seen = {}

    def run(kind, prompt, instructions, *args):
        seen["kind"], seen["prompt"], seen["instructions"] = kind, prompt, instructions
        return json.dumps(ROWS)

    monkeypatch.setattr(imports, "run_json_prompt", run)
    return seen


def _post(client, team, user, text=DOC):
    return client.post(f"/api/teams/{team}/imports", data={"text": text}, headers=hdr(user))


def _upload(client, team, user, text=DOC):
    """Upload, then read the import back once the background extraction has run
    (TestClient runs background tasks before it returns the response)."""
    response = _post(client, team, user, text)
    assert response.status_code == 202, response.text
    return next(item for item in client.get(f"/api/teams/{team}/imports", headers=hdr(user)).json() if item["id"] == response.json()["id"])


def test_import_extracts_redacted_rows_for_review(client, fake_hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    response = _post(client, team, s0)
    assert response.status_code == 202, response.text
    # The upload returns at once; Hermes reads in the background, so leaving the page loses nothing.
    assert (response.json()["status"], response.json()["items"]) == ("reading", [])
    body = _upload(client, team, s0)
    assert body["status"] == "review" and body["uploaded_by"] == s0 and body["error"] is None
    assert [row["kind"] for row in body["items"]] == ["brief", "deliverable", "deliverable", "milestone", "criterion", "criterion"]
    demo = body["items"][2]["data"]
    assert (demo["due"], demo["due_text"]) == (None, "week 14")
    assert "prof@example.edu" not in fake_hermes["prompt"] and "[email]" in fake_hermes["prompt"]
    assert "untrusted" in fake_hermes["instructions"] and "Do not call any tools" in fake_hermes["instructions"]
    assert [event["type"] for event in events_for(team)][-2:] == ["import.created", "import.updated"]
    # Nothing changes for the team until a proposal is accepted.
    assert client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["proposals"] == []


def test_docx_upload_is_read(client, fake_hermes):
    from docx import Document

    world = make_world()
    document = Document()
    document.add_paragraph(DOC)
    buffer = io.BytesIO()
    document.save(buffer)
    response = client.post(f"/api/teams/{world['team_id']}/imports", headers=hdr(world["students"][0]),
                           files={"file": ("brief.docx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert response.status_code == 202, response.text
    assert response.json()["filename"] == "brief.docx"
    assert "clinics lose paper records" in fake_hermes["prompt"]


def test_unsupported_file_and_outsider_are_refused(client, fake_hermes):
    world = make_world()
    team = world["team_id"]
    bad = client.post(f"/api/teams/{team}/imports", headers=hdr(world["students"][0]), files={"file": ("brief.exe", b"MZ" * 100, "application/octet-stream")})
    assert bad.status_code == 422
    assert _post(client, team, world["instructor"]).status_code == 403
    assert _post(client, team, world["outsider"]).status_code == 403


def test_ticked_rows_become_one_batch_proposal(client, fake_hermes):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    rows = _upload(client, team, s1)
    ticked = [{"kind": row["kind"], "data": row["data"]} for row in rows["items"] if row["data"].get("due_text") != "week 14"]
    assert client.post(f"/api/imports/{rows['id']}/propose", json={"items": ticked}, headers=hdr(s0)).status_code == 403
    response = client.post(f"/api/imports/{rows['id']}/propose", json={"items": ticked}, headers=hdr(s1))
    assert response.status_code == 200, response.text
    proposal = response.json()["proposal"]
    assert proposal["kind"] == "batch" and proposal["scope"] == "team"
    assert [op["kind"] for op in proposal["payload"]["ops"]] == ["brief", "deliverables", "milestones", "rubric"]
    assert proposal["summary"].startswith("Project setup from Pasted text")
    assert proposal["warnings"] == []
    assert client.post(f"/api/imports/{rows['id']}/propose", json={"items": ticked}, headers=hdr(s1)).status_code == 409
    for member in (s0, s1):
        client.post(f"/api/proposals/{proposal['id']}/vote", json={"vote": "up"}, headers=hdr(member))
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s2)).json()
    assert state["team"]["project"]["brief"]["problem"] == "Clinics lose paper records"
    milestone = next(item for item in state["milestones"] if item["title"] == "SRS submitted")
    assert milestone["due"].startswith("2026-10-20T23:59")
    assert [document["kind"] for document in state["documents"]] == ["srs"]


def test_undated_rows_cannot_be_proposed(client, fake_hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    rows = _upload(client, team, s0)
    undated = [{"kind": row["kind"], "data": row["data"]} for row in rows["items"] if row["data"].get("due_text") == "week 14"]
    response = client.post(f"/api/imports/{rows['id']}/propose", json={"items": undated}, headers=hdr(s0))
    assert response.status_code == 422 and "calendar date" in response.json()["detail"]
    # The review screen sends the end of the picked day in the student's time zone (here UTC+3).
    fixed = [{"kind": "deliverable", "data": {**undated[0]["data"], "due": "2026-12-10T20:59:00.000Z"}}]
    response = client.post(f"/api/imports/{rows['id']}/propose", json={"items": fixed}, headers=hdr(s0))
    assert response.status_code == 200, response.text
    assert response.json()["proposal"]["payload"]["ops"][0]["payload"]["deliverables"][0]["due"].startswith("2026-12-10T20:59")


def test_existing_milestones_are_not_duplicated(client, fake_hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    client.post(f"/api/teams/{team}/milestones", json={"title": "SRS submitted"}, headers=hdr(s0))
    rows = _upload(client, team, s0)
    milestone_only = [{"kind": row["kind"], "data": row["data"]} for row in rows["items"] if row["kind"] == "milestone"]
    response = client.post(f"/api/imports/{rows['id']}/propose", json={"items": milestone_only}, headers=hdr(s0))
    assert response.status_code == 422 and "already exists" in response.json()["detail"]


def test_lead_can_discard_someone_elses_import(client, fake_hermes):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    rows = _upload(client, team, s1)
    assert client.post(f"/api/imports/{rows['id']}/discard", headers=hdr(s2)).status_code == 403
    assert client.post(f"/api/imports/{rows['id']}/discard", headers=hdr(s0)).json()["status"] == "discarded"
    assert client.get(f"/api/teams/{team}/imports", headers=hdr(s1)).json() == []


def test_a_failed_read_is_shown_with_its_reason(client, monkeypatch):
    def fail(*args):
        raise imports.HermesJsonError("Hermes gateway unavailable", status=502)

    monkeypatch.setattr(imports, "run_json_prompt", fail)
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    item = _upload(client, team, s0)
    assert (item["status"], item["error"]) == ("failed", "Hermes gateway unavailable")
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()
    assert [row["status"] for row in state["imports"]] == ["failed"]
    assert client.post(f"/api/imports/{item['id']}/discard", headers=hdr(s0)).json()["status"] == "discarded"


def _reading_import(team, user, minutes_ago=0):
    from datetime import datetime, timedelta, timezone

    from app.database import SessionLocal
    from app.teams.models import TeamImport

    db = SessionLocal()
    try:
        item = TeamImport(team_id=team, uploaded_by=user, filename="brief.pdf", status="reading",
                          created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
        db.add(item)
        db.commit()
        return item.id
    finally:
        db.close()


def test_one_read_at_a_time_per_member_and_a_discarded_read_stays_discarded(client, fake_hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    import_id = _reading_import(team, s0)
    assert _post(client, team, s0).status_code == 409
    assert client.post(f"/api/imports/{import_id}/discard", headers=hdr(s0)).json()["status"] == "discarded"
    # Hermes finishing after the discard must not bring the import back.
    imports.read_import(import_id, DOC, None, None, None)
    assert client.get(f"/api/teams/{team}/imports", headers=hdr(s0)).json() == []


def test_a_read_lost_to_a_restart_times_out_as_failed(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    _reading_import(team, s0, minutes_ago=30)
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()
    assert state["imports"][0]["status"] == "failed" and "did not finish" in state["imports"][0]["error"]
