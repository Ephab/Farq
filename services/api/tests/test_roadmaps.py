import pytest
from pydantic import ValidationError

from app.roadmaps import apply_operations
from app.schemas import RoadmapNode, RoadmapOperation, RoadmapSnapshot, RoadmapStage


def snapshot(status: str = "not-started") -> RoadmapSnapshot:
    return RoadmapSnapshot(
        stages=[RoadmapStage(id="one", title="One", nodeIds=["a", "b"])],
        nodes=[
            RoadmapNode(id="a", stageId="one", title="A", status=status),
            RoadmapNode(id="b", stageId="one", title="B", deps=["a"]),
        ],
    )


def test_adds_future_node_and_keeps_graph_valid():
    result = apply_operations(snapshot(), [RoadmapOperation(
        type="add_node",
        node_id="c",
        node=RoadmapNode(id="c", stageId="one", title="C", deps=["b"]),
    )])
    assert [node.id for node in result.nodes] == ["a", "b", "c"]
    assert result.stages[0].nodeIds[-1] == "c"


def test_protects_completed_history():
    with pytest.raises(ValueError, match="protected"):
        apply_operations(snapshot("done"), [RoadmapOperation(type="update_node", node_id="a", changes={"title": "Changed"})])


def test_rejects_dependency_cycle():
    with pytest.raises(ValidationError, match="acyclic"):
        apply_operations(snapshot(), [RoadmapOperation(type="set_dependencies", node_id="a", dependencies=["b"])])


def test_rejects_identity_or_progress_rewrite():
    with pytest.raises(ValueError, match="Identity and progress"):
        apply_operations(snapshot(), [RoadmapOperation(type="update_node", node_id="a", changes={"status": "done"})])

