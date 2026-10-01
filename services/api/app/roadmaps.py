from __future__ import annotations

from copy import deepcopy

from .schemas import RoadmapOperation, RoadmapSnapshot


PROTECTED_STATUSES = {"done", "in-progress"}
# What a proposal may edit on a future node. Structure goes through move_node/set_dependencies,
# progress and evidence only through the student, and opportunity metadata only through the
# cached source (normalize_opportunity_operations), never a model-written value.
EDITABLE_FIELDS = {"title", "icon", "tagline", "description", "subtopics", "resources", "duration", "level", "rationale"}


def apply_operations(snapshot: RoadmapSnapshot, operations: list[RoadmapOperation]) -> RoadmapSnapshot:
    data = deepcopy(snapshot.model_dump())
    nodes = {node["id"]: node for node in data["nodes"]}
    stages = {stage["id"]: stage for stage in data["stages"]}

    for operation in operations:
        current = nodes.get(operation.node_id)
        if current and current.get("status") in PROTECTED_STATUSES:
            raise ValueError(f"{operation.node_id} is protected because work has already started")

        if operation.type == "add_node":
            if operation.node is None or operation.node.id != operation.node_id:
                raise ValueError("add_node requires a matching node payload")
            if operation.node_id in nodes:
                raise ValueError(f"{operation.node_id} already exists")
            node = operation.node.model_dump()
            if node["stageId"] not in stages:
                raise ValueError("New node belongs to an unknown stage")
            # New work starts from scratch: only the student marks progress or links evidence/projects.
            node.update(status="not-started", evidence=[], projectId=None)
            nodes[operation.node_id] = node
            stages[node["stageId"]]["nodeIds"].append(operation.node_id)
        elif operation.type == "update_node":
            if current is None or not operation.changes:
                raise ValueError("update_node requires an existing node and changes")
            blocked = set(operation.changes) - EDITABLE_FIELDS
            if blocked:
                raise ValueError(f"A proposal cannot change {', '.join(sorted(blocked))} with update_node")
            current.update(operation.changes)
        elif operation.type == "remove_node":
            if current is None:
                raise ValueError(f"{operation.node_id} does not exist")
            dependents = [node["id"] for node in nodes.values() if operation.node_id in node["deps"] and node.get("status") in PROTECTED_STATUSES]
            if dependents:
                raise ValueError(f"{operation.node_id} cannot be removed: started work depends on it ({', '.join(dependents)})")
            nodes.pop(operation.node_id)
            for stage in stages.values():
                stage["nodeIds"] = [item for item in stage["nodeIds"] if item != operation.node_id]
            for node in nodes.values():
                node["deps"] = [dep for dep in node["deps"] if dep != operation.node_id]
        elif operation.type == "move_node":
            if current is None or operation.stage_id not in stages:
                raise ValueError("move_node requires an existing node and stage")
            for stage in stages.values():
                stage["nodeIds"] = [item for item in stage["nodeIds"] if item != operation.node_id]
            target = stages[operation.stage_id]["nodeIds"]
            position = len(target) if operation.position is None else max(0, min(operation.position, len(target)))
            target.insert(position, operation.node_id)
            current["stageId"] = operation.stage_id
        elif operation.type == "set_dependencies":
            if current is None or operation.dependencies is None:
                raise ValueError("set_dependencies requires an existing node and dependencies")
            unknown = [dep for dep in operation.dependencies if dep not in nodes or dep == operation.node_id]
            if unknown:
                raise ValueError(f"Unknown or self dependencies: {', '.join(unknown)}")
            current["deps"] = list(dict.fromkeys(operation.dependencies))

    data["nodes"] = list(nodes.values())
    data["stages"] = list(stages.values())
    return RoadmapSnapshot.model_validate(data)

