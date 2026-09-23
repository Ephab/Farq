from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


FactCategory = Literal["interest", "goal", "course", "skill", "strength", "weakness", "achievement", "preference"]
NodeStatus = Literal["not-started", "in-progress", "done"]


class RoadmapResource(BaseModel):
    label: str
    url: str


class RoadmapNode(BaseModel):
    id: str
    stageId: str
    title: str
    icon: str = "route"
    tagline: str = ""
    description: str = ""
    subtopics: list[str] = Field(default_factory=list)
    resources: list[RoadmapResource] = Field(default_factory=list)
    duration: str = "1 week"
    level: Literal["Beginner", "Intermediate", "Advanced"] = "Beginner"
    deps: list[str] = Field(default_factory=list)
    status: NodeStatus = "not-started"


class RoadmapStage(BaseModel):
    id: str
    title: str
    description: str = ""
    nodeIds: list[str] = Field(default_factory=list)


class RoadmapSnapshot(BaseModel):
    title: str = "Computer Vision Roadmap"
    stages: list[RoadmapStage]
    nodes: list[RoadmapNode]

    @model_validator(mode="after")
    def valid_graph(self) -> "RoadmapSnapshot":
        ids = [node.id for node in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("Roadmap contains duplicate node IDs")
        known = set(ids)
        stage_ids = {stage.id for stage in self.stages}
        graph = {node.id: node.deps for node in self.nodes}
        for node in self.nodes:
            if node.stageId not in stage_ids:
                raise ValueError(f"{node.id} belongs to an unknown stage")
            if any(dep not in known for dep in node.deps):
                raise ValueError(f"{node.id} references an unknown prerequisite")
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visiting:
                raise ValueError("Roadmap dependencies must be acyclic")
            if node_id in visited:
                return
            visiting.add(node_id)
            for dep in graph[node_id]:
                visit(dep)
            visiting.remove(node_id)
            visited.add(node_id)

        for node_id in graph:
            visit(node_id)
        return self


class RoadmapOperation(BaseModel):
    type: Literal["add_node", "update_node", "remove_node", "move_node", "set_dependencies"]
    node_id: str
    node: RoadmapNode | None = None
    changes: dict[str, Any] | None = None
    stage_id: str | None = None
    position: int | None = None
    dependencies: list[str] | None = None


class ProposalCreate(BaseModel):
    user_id: str
    base_version_id: str
    summary: str = Field(min_length=3, max_length=240)
    reasoning: str = Field(min_length=3)
    operations: list[RoadmapOperation] = Field(min_length=1, max_length=20)


class FactCreate(BaseModel):
    user_id: str
    category: FactCategory
    key: str = Field(min_length=1, max_length=120)
    value: Any
    source_message_id: str | None = None
    explicit: bool = True


class ChatInput(BaseModel):
    content: str = Field(min_length=1, max_length=8000)

