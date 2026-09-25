from __future__ import annotations

"""Stitch completed stages into one snapshot + the wiring logic check.

The wiring check is the small dedicated step that guarantees connections
make sense: unique IDs, known stages, deps pointing only backwards
(same or earlier stage), and an acyclic graph. Anything else rejects the
stage so it is retried with the error instead of stored.
"""

from ..schemas import RoadmapNode, RoadmapPlan, RoadmapSnapshot, RoadmapStage


def merge_stages(title: str, plan: RoadmapPlan, completed: dict[str, list[RoadmapNode]]) -> RoadmapSnapshot:
    """Combine per-stage nodes into a snapshot in plan order."""
    stages = [
        RoadmapStage(id=item.id, title=item.title, description=item.description, nodeIds=[node.id for node in completed.get(item.id, [])], stageType=item.stage_type)
        for item in plan.stages
    ]
    nodes = [node for item in plan.stages for node in completed.get(item.id, [])]
    return RoadmapSnapshot.model_validate({"title": title, "stages": stages, "nodes": [node.model_dump() for node in nodes]})


def check_wiring(plan: RoadmapPlan, completed: dict[str, list[RoadmapNode]]) -> str | None:
    """Return an error message when cross-stage connections are wrong, else None."""
    order = [item.id for item in plan.stages]
    position = {stage_id: index for index, stage_id in enumerate(order)}
    seen: dict[str, str] = {}  # node id -> stage id
    for stage_id in order:
        for node in completed.get(stage_id, []):
            if node.id in seen:
                return f"Duplicate node ID {node.id} (also in stage {seen[node.id]})"
            seen[node.id] = stage_id
            for dep in node.deps:
                if dep not in seen and dep != node.id:
                    # dep may be a later node of the SAME stage batch not seen yet;
                    # allow it only if it belongs to this stage.
                    same_stage = {item.id for item in completed.get(stage_id, [])}
                    if dep not in same_stage:
                        return (
                            f"{node.id} (stage {stage_id}) depends on unknown or future node {dep}. "
                            "Only nodes from this or earlier stages are allowed"
                        )
                elif dep in seen and position[seen[dep]] > position[stage_id]:
                    return f"{node.id} depends on future-stage node {dep}"
                if dep == node.id:
                    return f"{node.id} depends on itself"
    # Cycle check over the merged graph.
    graph = {node.id: node.deps for nodes in completed.values() for node in nodes}
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> str | None:
        if node_id in visiting:
            return f"Dependency cycle detected at {node_id}"
        if node_id in visited or node_id not in graph:
            return None
        visiting.add(node_id)
        for dep in graph[node_id]:
            error = visit(dep)
            if error:
                return error
        visiting.remove(node_id)
        visited.add(node_id)
        return None

    for node_id in graph:
        error = visit(node_id)
        if error:
            return error
    return None
