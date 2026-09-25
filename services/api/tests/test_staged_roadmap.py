import json
import os
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"farq-staged-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.schemas import RoadmapNode, RoadmapPlan, RoadmapSnapshot, validate_generated, validate_plan, validate_stage_nodes  # noqa: E402
from app.roadmap_gen import stitch as roadmap_stitch  # noqa: E402

INTERNAL = {"X-Farq-Internal-Token": "farq-internal-dev"}
HERMES = {"X-Hermes-Api-Key": "test-gateway-key-0123456789"}


@pytest.fixture(scope="module")
def client():
    from app.database import engine
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


class _Response:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text or json.dumps(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def staged_gateway(plan_output: str, stage_outputs: dict[str, str], prompts: list[str]):
    """Gateway stub routing each run to the plan or the matching stage output."""

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            prompts.append(json["input"])
            assert headers["X-Hermes-Session-Key"].startswith("farq:roadmap:")
            return _Response({"run_id": f"run-{len(prompts)}"})

        def get(self, url, headers=None):
            last = prompts[-1]
            if "Plan the student" in last:
                return _Response({"status": "completed", "output": plan_output})
            for stage_id, output in stage_outputs.items():
                if f'"{stage_id}"' in last:
                    return _Response({"status": "completed", "output": output})
            return _Response({"status": "completed", "output": plan_output})

    return FakeClient


def new_student(client: TestClient, name: str = "Staged Student") -> dict:
    created = client.post("/api/students", json={"display_name": name})
    assert created.status_code == 201
    return created.json()


def stage_nodes(ids: list[str], deps: dict[str, list[str]] | None = None) -> list[dict]:
    deps = deps or {}
    return [{"id": node_id, "title": f"Topic {node_id}", "deps": deps.get(node_id, [])} for node_id in ids]


PLAN = {
    "title": "AI Engineer Roadmap",
    "stages": [
        {"id": "foundations", "title": "Stage 1 · Foundations", "description": "Base skills", "node_count": 2, "goal": "Ready for core"},
        {"id": "core", "title": "Stage 2 · Core", "description": "Main topics", "node_count": 2, "goal": "Ready for career"},
        {"id": "career", "title": "Stage 3 · Career", "description": "Job readiness", "node_count": 2, "goal": "Hired"},
    ],
}

STAGE_PAYLOADS = {
    "foundations": {"nodes": stage_nodes(["py-basics", "math-basics"])},
    "core": {"nodes": stage_nodes(["ml-core", "dl-core"], {"ml-core": ["py-basics"], "dl-core": ["ml-core", "math-basics"]})},
    "career": {"nodes": stage_nodes(["portfolio", "interviews"], {"portfolio": ["ml-core", "dl-core"], "interviews": ["portfolio"]})},
}


def prepare_student(client: TestClient) -> str:
    student = new_student(client)
    sid = student["student_id"]
    client.put(f"/api/students/{sid}/profile", json={"program": "Computer Science", "institution": "Test University"})
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "linkedin_zip"}).json()
    client.post("/internal/hermes/evidence", headers=INTERNAL, json={
        "user_id": sid, "source_id": source["id"],
        "items": [{"kind": "course", "title": "Intro to CS", "data": {"code": "CS 101", "grade": "A"}}],
    })
    evidence_id = client.get(f"/api/students/{sid}/evidence").json()[0]["id"]
    client.post(f"/api/students/{sid}/evidence/decide", json={"confirm": [evidence_id]})
    return sid


def test_readiness_gate_blocks_then_passes(client: TestClient):
    sid = new_student(client)["student_id"]
    blocked = client.get(f"/api/students/{sid}/onboarding/readiness").json()
    assert blocked["ready"] is False and blocked["blockers"]
    ready_sid = prepare_student(client)
    ready = client.get(f"/api/students/{ready_sid}/onboarding/readiness").json()
    assert ready["ready"] is True and ready["blockers"] == []
    assert ready["confirmed_evidence"] == 1


def test_validate_plan_rejects_duplicate_stages():
    plan = RoadmapPlan.model_validate({"title": "T", "stages": [
        {"id": "a", "title": "Stage 1 · A"},
        {"id": "a", "title": "Stage 2 · A again"},
    ]})
    with pytest.raises(ValueError, match="duplicate stage"):
        validate_plan(plan)


def test_validate_stage_nodes_rejects_forward_deps():
    nodes = [
        RoadmapNode(id="n1", stageId="s2", title="x", deps=["future-node"]),
        RoadmapNode(id="n2", stageId="s2", title="y"),
    ]
    with pytest.raises(ValueError, match="unknown prerequisite"):
        validate_stage_nodes(nodes, "s2", set(), set())
    ok = [RoadmapNode(id="n1", stageId="s2", title="x", deps=["s1-node", "n2"]),
          RoadmapNode(id="n2", stageId="s2", title="y")]
    assert len(validate_stage_nodes(ok, "s2", set(), {"s1-node"})) == 2


def test_check_wiring_catches_bad_connections():
    plan = RoadmapPlan.model_validate(PLAN)
    good = {
        "foundations": [RoadmapNode(id="a", stageId="foundations", title="a")],
        "core": [RoadmapNode(id="b", stageId="core", title="b", deps=["a"])],
        "career": [],
    }
    assert roadmap_stitch.check_wiring(plan, good) is None
    future = {
        "foundations": [RoadmapNode(id="a", stageId="foundations", title="a", deps=["b"])],
        "core": [RoadmapNode(id="b", stageId="core", title="b")],
        "career": [],
    }
    assert "future" in roadmap_stitch.check_wiring(plan, future)
    dup = {
        "foundations": [RoadmapNode(id="a", stageId="foundations", title="a")],
        "core": [RoadmapNode(id="a", stageId="core", title="a2")],
        "career": [],
    }
    assert "Duplicate" in roadmap_stitch.check_wiring(plan, dup)


def test_plan_stage_finalize_flow(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    sid = prepare_student(client)
    prompts: list[str] = []
    monkeypatch.setattr(
        "app.hermes.httpx.Client",
        staged_gateway(json.dumps(PLAN), {key: json.dumps(value) for key, value in STAGE_PAYLOADS.items()}, prompts),
    )
    planned = client.post(f"/api/students/{sid}/onboarding/roadmap/plan", json={}, headers=HERMES)
    assert planned.status_code == 200, planned.text
    job_id = planned.json()["job_id"]
    assert [stage["id"] for stage in planned.json()["plan"]["stages"]] == ["foundations", "core", "career"]

    seen: list[str] = []
    for stage_id in ("foundations", "core", "career"):
        generated = client.post(
            f"/api/students/{sid}/onboarding/roadmap/stages/{stage_id}/generate",
            json={"job_id": job_id}, headers=HERMES,
        )
        assert generated.status_code == 200, generated.text
        body = generated.json()
        seen.extend(node["id"] for node in body["nodes"])
        # The snapshot so far only contains wired stages.
        snapshot = RoadmapSnapshot.model_validate(body["snapshot"])
        assert {node.id for node in snapshot.nodes} == set(seen)
    assert seen == ["py-basics", "math-basics", "ml-core", "dl-core", "portfolio", "interviews"]

    finalized = client.post(f"/api/students/{sid}/onboarding/roadmap/finalize", json={"job_id": job_id})
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["snapshot"]["title"] == "AI Engineer Roadmap"
    # Stored as a pending proposal; only accept activates it.
    assert client.get(f"/api/students/{sid}/roadmap").json()["version"] == 0
    accepted = client.post(f"/api/roadmap-proposals/{finalized.json()['id']}/accept", json={"not_done": []})
    assert accepted.status_code == 200 and accepted.json()["version"] == 1
    active = client.get(f"/api/students/{sid}/roadmap").json()
    assert active["snapshot"]["title"] == "AI Engineer Roadmap"
    validate_generated(RoadmapSnapshot.model_validate(active["snapshot"]), set())
    # Still not active until accepted; generating again is rejected.
    assert client.post(f"/api/students/{sid}/onboarding/generate", json={}).status_code == 409


def test_two_stages_generate_in_parallel_without_corruption(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Two independent stage generations run concurrently must not clobber each other.

    Within one job stages run sequentially (a stage needs earlier node IDs
    for wiring); parallelism is for independent work — here the first stage
    of two separate jobs. A concurrent double-submit of the same stage must
    serialize to one success plus one 409, never a duplicated stage.
    """
    sid_a = prepare_student(client)
    sid_b = prepare_student(client)
    prompts: list[str] = []
    monkeypatch.setattr(
        "app.hermes.httpx.Client",
        staged_gateway(json.dumps(PLAN), {key: json.dumps(value) for key, value in STAGE_PAYLOADS.items()}, prompts),
    )
    job_a = client.post(f"/api/students/{sid_a}/onboarding/roadmap/plan", json={}, headers=HERMES).json()["job_id"]
    job_b = client.post(f"/api/students/{sid_b}/onboarding/roadmap/plan", json={}, headers=HERMES).json()["job_id"]

    def make_first_stage(args: tuple[str, str]):
        sid, job_id = args
        # Each thread needs its own TestClient-adjacent call; the app is thread-safe.
        return client.post(
            f"/api/students/{sid}/onboarding/roadmap/stages/foundations/generate",
            json={"job_id": job_id}, headers=HERMES,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(make_first_stage, [(sid_a, job_a), (sid_b, job_b)]))
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert {node["id"] for node in first.json()["nodes"]} == {"py-basics", "math-basics"}
    assert {node["id"] for node in second.json()["nodes"]} == {"py-basics", "math-basics"}
    # Same stage submitted twice concurrently: one wins, the other gets 409.
    def make_core(_: int):
        return client.post(
            f"/api/students/{sid_a}/onboarding/roadmap/stages/core/generate",
            json={"job_id": job_a}, headers=HERMES,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        dupes = list(pool.map(make_core, [1, 2]))
    assert sorted(item.status_code for item in dupes) == [200, 409]

    for sid, job_id, remaining in ((sid_a, job_a, ("career",)), (sid_b, job_b, ("core", "career"))):
        for stage_id in remaining:
            generated = client.post(
                f"/api/students/{sid}/onboarding/roadmap/stages/{stage_id}/generate",
                json={"job_id": job_id}, headers=HERMES,
            )
            assert generated.status_code == 200, generated.text
        finalized = client.post(f"/api/students/{sid}/onboarding/roadmap/finalize", json={"job_id": job_id})
        assert finalized.status_code == 200, finalized.text
        snapshot = RoadmapSnapshot.model_validate(finalized.json()["snapshot"])
        assert len(snapshot.nodes) == 6 and len({node.id for node in snapshot.nodes}) == 6
        # Cross-stage connections survived the parallel run.
        by_id = {node.id: node for node in snapshot.nodes}
        assert by_id["ml-core"].deps == ["py-basics"]
        assert by_id["portfolio"].deps == ["ml-core", "dl-core"]


def test_stage_with_unknown_dep_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    sid = prepare_student(client)
    bad = {"foundations": {"nodes": stage_nodes(["x1", "x2"], {"x1": ["ghost-node"]})}}
    prompts: list[str] = []
    monkeypatch.setattr("app.hermes.httpx.Client", staged_gateway(json.dumps(PLAN), {key: json.dumps(value) for key, value in bad.items()}, prompts))
    job_id = client.post(f"/api/students/{sid}/onboarding/roadmap/plan", json={}, headers=HERMES).json()["job_id"]
    response = client.post(f"/api/students/{sid}/onboarding/roadmap/stages/foundations/generate", json={"job_id": job_id}, headers=HERMES)
    assert response.status_code in (422, 502)
    assert client.post(f"/api/students/{sid}/onboarding/roadmap/finalize", json={"job_id": job_id}).status_code == 409
