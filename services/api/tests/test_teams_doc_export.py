import io
import zipfile

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import DocSection


def _srs(client, world):
    return client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "srs"}, headers=hdr(world["students"][0])).json()


def _keys(client, world, document_id):
    documents = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(world["students"][0])).json()["documents"]
    return [section["key"] for section in next(d for d in documents if d["id"] == document_id)["sections"]]


def _section(document, key):
    return next(section for section in document["sections"] if section["key"] == key)


def test_add_a_section_after_another(client):
    world = make_world()
    document = _srs(client, world)
    after = _section(document, "1.1")
    added = client.post(f"/api/documents/{document['id']}/sections", json={"key": "1.1a", "title": "Audience", "after_section_id": after["id"]}, headers=hdr(world["students"][0]))
    assert added.status_code == 201, added.text
    assert _keys(client, world, document["id"])[:4] == ["1", "1.1", "1.1a", "1.2"]
    event = events_for(world["team_id"])[-1]
    assert event["type"] == "document.updated" and event["payload"]["change"] == {"action": "section_added", "key": "1.1a", "title": "Audience"}
    duplicate = client.post(f"/api/documents/{document['id']}/sections", json={"key": "1.1", "title": "Again"}, headers=hdr(world["students"][0]))
    assert duplicate.status_code == 422


def test_move_rename_and_delete_sections(client):
    world = make_world()
    s0 = world["students"][0]
    document = _srs(client, world)
    purpose = _section(document, "1.1")
    assert client.post(f"/api/sections/{purpose['id']}/move", json={"direction": "down"}, headers=hdr(s0)).status_code == 200
    assert _keys(client, world, document["id"])[1:3] == ["1.2", "1.1"]
    first = _section(document, "1")
    assert client.post(f"/api/sections/{first['id']}/move", json={"direction": "up"}, headers=hdr(s0)).status_code == 422
    renamed = client.patch(f"/api/sections/{purpose['id']}", json={"key": "1.9", "title": "Goals"}, headers=hdr(s0)).json()
    assert (renamed["key"], renamed["title"]) == ("1.9", "Goals")
    assert client.patch(f"/api/sections/{purpose['id']}", json={"key": "1.2"}, headers=hdr(s0)).status_code == 422
    assert client.delete(f"/api/sections/{purpose['id']}", headers=hdr(s0)).status_code == 200
    assert "1.9" not in _keys(client, world, document["id"])
    renamed_doc = client.patch(f"/api/documents/{document['id']}", json={"title": "Falcon Finder SRS"}, headers=hdr(s0))
    assert renamed_doc.json()["title"] == "Falcon Finder SRS"


def test_cannot_delete_a_section_someone_is_editing_or_the_last_one(client):
    world = make_world()
    s0, s1 = world["students"][:2]
    custom = client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "custom", "title": "Test plan", "sections": [{"key": "1", "title": "Scope"}, {"key": "2", "title": "Cases"}]}, headers=hdr(s0)).json()
    first, second = custom["sections"]
    client.post(f"/api/sections/{second['id']}/lock", headers=hdr(s1))
    assert client.delete(f"/api/sections/{second['id']}", headers=hdr(s0)).status_code == 409
    assert client.delete(f"/api/sections/{first['id']}", headers=hdr(s0)).status_code == 200
    client.post(f"/api/sections/{second['id']}/unlock", headers=hdr(s1))
    assert client.delete(f"/api/sections/{second['id']}", headers=hdr(s0)).status_code == 422


def _written(client, world):
    document = _srs(client, world)
    db = SessionLocal()
    try:
        db.get(DocSection, _section(document, "1.1")["id"]).content_md = "Falcon Finder helps students **find** lost items.\n\n- Report items\n- Claim items"
        db.get(DocSection, _section(document, "1.2")["id"]).content_md = "هذا النظام يساعد الطلاب <script>alert(1)</script>"
        db.commit()
    finally:
        db.close()
    return document


def _export(client, world, document, fmt, style="ieee", user=None):
    return client.get(f"/api/documents/{document['id']}/export", params={"format": fmt, "style": style}, headers=hdr(user or world["students"][0]))


def test_markdown_export_has_cover_contents_and_sections(client):
    world = make_world()
    document = _written(client, world)
    response = _export(client, world, document, "md")
    assert response.status_code == 200, response.text
    text = response.text
    assert text.startswith("# Software Requirements Specification")
    assert "Student 0" in text and "Student 1" in text and world["team_id"] not in text
    assert "## Contents" in text and "- 1.1 Purpose" in text
    assert "## 1 Introduction" in text and "### 1.1 Purpose" in text
    assert "Falcon Finder helps students **find** lost items." in text
    assert "attachment" in response.headers["content-disposition"]


def test_word_export_is_a_real_docx_in_both_styles(client):
    world = make_world()
    document = _written(client, world)
    fonts = {}
    for style in ("ieee", "modern"):
        response = _export(client, world, document, "docx", style)
        assert response.status_code == 200, response.text
        package = zipfile.ZipFile(io.BytesIO(response.content))
        body = package.read("word/document.xml").decode("utf-8")
        assert "Software Requirements Specification" in body and "Contents" in body and "1.1 Purpose" in body
        assert "lost items" in body and "<w:bidi/>" in body
        fonts[style] = package.read("word/styles.xml").decode("utf-8")
    assert "Times New Roman" in fonts["ieee"] and "Times New Roman" not in fonts["modern"]


def test_print_export_escapes_content_and_prints(client):
    world = make_world()
    document = _written(client, world)
    html = _export(client, world, document, "html", "modern").text
    assert 'class="modern"' in html and "Contents" in html and "print()" in html
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert 'dir="auto"' in html


@pytest.mark.parametrize(("who", "status"), [("instructor", 200), ("outsider", 403)])
def test_export_access(client, who, status):
    world = make_world()
    document = _srs(client, world)
    assert _export(client, world, document, "md", user=world[who]).status_code == status


def test_export_rejects_unknown_formats(client):
    world = make_world()
    document = _srs(client, world)
    assert _export(client, world, document, "exe").status_code == 422


def test_structural_doc_edits_appear_in_the_activity_log(client):
    world = make_world()
    s0 = world["students"][0]
    document = _srs(client, world)
    client.post(f"/api/documents/{document['id']}/sections", json={"key": "5", "title": "Appendix"}, headers=hdr(s0))
    client.post(f"/api/sections/{_section(document, '1.1')['id']}/move", json={"direction": "down"}, headers=hdr(s0))
    client.delete(f"/api/sections/{_section(document, '1.3')['id']}", headers=hdr(s0))
    texts = [entry["text"] for entry in client.get(f"/api/teams/{world['team_id']}/activity", headers=hdr(s0)).json()["entries"]]
    assert "deleted section 1.3 Definitions and acronyms from Software Requirements Specification" in texts
    assert "reordered section 1.1 Purpose in Software Requirements Specification" in texts
    assert "added section 5 Appendix to Software Requirements Specification" in texts
