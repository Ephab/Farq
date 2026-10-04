"""Opt-in legacy team import: dry run, stable idempotent IDs, consent for teammates, hard validation (PostgreSQL)."""
import copy

from sqlalchemy import func, select

from collaboration.legacy_import import LegacyImport
from collaboration.teams.models import DocSection, Task, Team, TeamEvent, TeamMember, TeamMessage

from test_team_hermes import hdr, world  # noqa: F401  (fixture)

BUNDLE = {
    "version": 1, "source_team_id": "local-team-1", "name": "Capstone", "charter": {"goal": "Ship it"},
    "project": {"brief": {"title": "Capstone"}, "deliverables": [{"key": "srs", "title": "SRS"}], "rubric": []},
    "members": [{"local_user_id": "u-alice", "display_name": "Alice", "is_lead": True},
                {"local_user_id": "u-sam", "display_name": "Sam", "is_lead": False}],
    "milestones": [{"id": "m1", "title": "SRS due", "due": "2026-11-01T00:00:00Z", "deliverable_key": "srs"}],
    "tasks": [
        {"id": "t1", "title": "Write intro", "status": "done", "assignee_local_id": "u-alice", "estimate_points": 2, "milestone_id": "m1", "position": 1},
        {"id": "t2", "title": "Design schema", "description": "ERD", "status": "doing", "assignee_local_id": "u-sam", "depends_on": ["t1"], "position": 2},
    ],
    "decisions": [{"id": "d1", "text": "Use Postgres"}],
    "documents": [{"id": "doc1", "kind": "srs", "title": "SRS", "sections": [
        {"id": "s1", "key": "1", "title": "Intro", "position": 0, "owner_local_id": "u-alice", "content_md": "Hello", "status": "draft"},
        {"id": "s2", "key": "2", "title": "Scope", "position": 1, "owner_local_id": "u-sam", "content_md": "", "status": "empty"}]}],
}


def post(client, who, bundle=BUNDLE, importer="u-alice", dry_run=False):
    return client.post("/v1/teams/import", json={"bundle": bundle, "importer_local_id": importer, "dry_run": dry_run}, headers=hdr(who))


def test_dry_run_reports_and_writes_nothing(world):  # noqa: F811
    client, app, settings, ids, team = world
    answer = post(client, "outsider", dry_run=True)
    assert answer.status_code == 200
    body = answer.json()
    assert body["counts"] == {"tasks": 2, "milestones": 1, "decisions": 1, "documents": 1, "sections": 2}
    assert "chat messages" in body["excluded"] and body["unassigned_to_invite"] == ["Sam"]
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(LegacyImport)) == 0
        assert db.scalar(select(func.count()).select_from(Team).where(Team.name == "Capstone")) == 0


def test_import_creates_one_member_team_keeps_history_and_never_assigns_others(world):  # noqa: F811
    client, app, settings, ids, team = world
    answer = post(client, "outsider")
    assert answer.status_code == 200, answer.text
    new_team = answer.json()["team_id"]
    state = client.get(f"/v1/teams/{new_team}/state", headers=hdr("outsider")).json()
    by_title = {task["title"]: task for task in state["tasks"]}
    assert by_title["Write intro"]["status"] == "done" and by_title["Write intro"]["assignee_id"] == ids["outsider"]
    assert by_title["Design schema"]["assignee_id"] is None and "previously assigned to Sam" in by_title["Design schema"]["description"]
    assert by_title["Write intro"]["milestone_id"] is not None
    with app.state.sessions() as db:
        assert [m.user_id for m in db.scalars(select(TeamMember).where(TeamMember.team_id == new_team))] == [ids["outsider"]]
        assert db.get(Team, new_team).lead_user_id == ids["outsider"]
        sections = {s.key: s for s in db.scalars(select(DocSection))if s.document_id}
        owned = [s for s in db.scalars(select(DocSection)) if s.content_md == "Hello"][0]
        assert owned.owner_user_id == ids["outsider"] and owned.version == 1
        scope = [s for s in db.scalars(select(DocSection)) if s.title == "Scope"][0]
        assert scope.owner_user_id is None and "Sam" in scope.meta_json
        dependency = [t for t in db.scalars(select(Task).where(Task.team_id == new_team)) if t.title == "Design schema"][0]
        assert dependency.depends_on_json != '["t1"]' and by_title["Write intro"]["id"] in dependency.depends_on_json
        assert db.scalars(select(TeamMessage).where(TeamMessage.team_id == new_team)).all() == []
        assert [e.type for e in db.scalars(select(TeamEvent).where(TeamEvent.team_id == new_team))][-1] == "team.imported"
    # Sam was not enrolled: he cannot see the team until the lead invites him and he accepts.
    assert client.get(f"/v1/teams/{new_team}/state", headers=hdr("bob")).status_code == 403
    assert client.get(f"/v1/teams/{new_team}/state", headers=hdr("alice")).status_code == 403


def test_repeat_is_refused_and_ids_are_per_importer(world):  # noqa: F811
    client, app, settings, ids, team = world
    first = post(client, "outsider").json()["team_id"]
    again = post(client, "outsider")
    assert again.status_code == 409 and first in again.json()["detail"]
    other = post(client, "alice")
    assert other.status_code == 200 and other.json()["team_id"] != first
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Task).where(Task.title == "Write intro")) == 2


def test_seeded_style_ids_with_dots_are_accepted(world):  # noqa: F811
    client, *_ = world
    bundle = copy.deepcopy(BUNDLE)
    bundle["documents"][0]["sections"][0]["id"] = "sec-falcon-srs-1.1"
    bundle["tasks"][1]["id"] = "task:falcon.2"
    assert post(client, "outsider", bundle=bundle).status_code == 200


def test_only_the_lead_member_can_move_a_team(world):  # noqa: F811
    client, *_ = world
    assert post(client, "outsider", importer="u-sam").status_code == 422
    assert post(client, "outsider", importer="u-ghost").status_code == 422


def test_invalid_bundles_are_rejected_before_anything_is_written(world):  # noqa: F811
    client, app, *_ = world
    cases = []
    bad = copy.deepcopy(BUNDLE); bad["tasks"][0]["status"] = "archived"; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["tasks"][0]["milestone_id"] = "nope"; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["tasks"][1]["depends_on"] = ["ghost"]; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["tasks"][1]["id"] = "t1"; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["version"] = 2; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["source_team_id"] = "../etc"; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["tasks"] = [{"id": f"t{i}", "title": "x"} for i in range(501)]; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["documents"][0]["kind"] = "exe"; cases.append(bad)
    bad = copy.deepcopy(BUNDLE); bad["tasks"][0]["estimate_points"] = 99; cases.append(bad)
    assert [post(client, "outsider", bundle=item).status_code for item in cases] == [422] * len(cases)
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(LegacyImport)) == 0


def test_daily_cap_and_auth(world):  # noqa: F811
    client, *_ = world
    for index in range(5):
        bundle = copy.deepcopy(BUNDLE); bundle["source_team_id"] = f"local-{index}"
        assert post(client, "outsider", bundle=bundle).status_code == 200
    bundle = copy.deepcopy(BUNDLE); bundle["source_team_id"] = "local-6"
    assert post(client, "outsider", bundle=bundle).status_code == 429
    assert client.post("/v1/teams/import", json={"bundle": BUNDLE, "importer_local_id": "u-alice"}).status_code in {401, 403}
