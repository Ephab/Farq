from __future__ import annotations

from copy import deepcopy

from .schemas import RoadmapOperation, RoadmapSnapshot


PROTECTED_FIELDS = {"id", "status"}


def apply_operations(snapshot: RoadmapSnapshot, operations: list[RoadmapOperation]) -> RoadmapSnapshot:
    data = deepcopy(snapshot.model_dump())
    nodes = {node["id"]: node for node in data["nodes"]}
    stages = {stage["id"]: stage for stage in data["stages"]}

    for operation in operations:
        current = nodes.get(operation.node_id)
        if current and current.get("status") in {"done", "in-progress"}:
            raise ValueError(f"{operation.node_id} is protected because work has already started")

        if operation.type == "add_node":
            if operation.node is None or operation.node.id != operation.node_id:
                raise ValueError("add_node requires a matching node payload")
            if operation.node_id in nodes:
                raise ValueError(f"{operation.node_id} already exists")
            node = operation.node.model_dump()
            if node["stageId"] not in stages:
                raise ValueError("New node belongs to an unknown stage")
            nodes[operation.node_id] = node
            stages[node["stageId"]]["nodeIds"].append(operation.node_id)
        elif operation.type == "update_node":
            if current is None or not operation.changes:
                raise ValueError("update_node requires an existing node and changes")
            if PROTECTED_FIELDS.intersection(operation.changes):
                raise ValueError("Identity and progress cannot be changed by Hermes")
            current.update(operation.changes)
        elif operation.type == "remove_node":
            if current is None:
                raise ValueError(f"{operation.node_id} does not exist")
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
            current["deps"] = operation.dependencies

    data["nodes"] = list(nodes.values())
    data["stages"] = list(stages.values())
    return RoadmapSnapshot.model_validate(data)

