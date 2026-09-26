from team_world import client, hdr  # noqa: F401

from app.database import SessionLocal
from app.identity import User


def test_student_header_becomes_a_user(client):
    response = client.get("/api/me", headers=hdr("demo-student"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == "demo-student"
    assert body["role"] == "student"
    assert body["student_id"] == "demo-student"


def test_missing_or_unknown_user_is_rejected(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=hdr("nobody-here")).status_code == 401


def test_instructor_user_is_resolved_and_listed(client):
    db = SessionLocal()
    try:
        if db.get(User, "inst-identity") is None:
            db.add(User(id="inst-identity", display_name="Dr. Identity", role="instructor"))
            db.commit()
    finally:
        db.close()
    body = client.get("/api/me", headers=hdr("inst-identity")).json()
    assert body["role"] == "instructor"
    assert body["student_id"] is None
    assert any(user["id"] == "inst-identity" for user in client.get("/api/demo/users").json())
