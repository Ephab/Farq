from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


FactCategory = Literal["interest", "goal", "course", "skill", "strength", "weakness", "achievement", "preference"]
HermesProvider = Literal["gemini", "nim"]
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
    provider: HermesProvider | None = None
    # Optional per-run model override. Allowlisted in app.hermes so the
    # gateway /v1/runs payload can switch models without mutating config.
    model: str | None = Field(default=None, min_length=1, max_length=200)


class ResetInput(BaseModel):
    confirm: Literal["RESET"]


QuizDifficulty = Literal["Easy", "Medium", "Hard", "Mixed"]
QuizQuestionType = Literal["mcq", "true_false", "short_answer"]


class QuizGenerateInput(BaseModel):
    source_text: str = Field(min_length=1, max_length=20000)
    count: int = Field(ge=1, le=20)
    difficulty: QuizDifficulty = "Mixed"
    types: list[QuizQuestionType] = Field(min_length=1, max_length=3)
    provider: HermesProvider | None = None
    # Optional per-run model override, allowlisted in app.quiz like chat models.
    model: str | None = Field(default=None, min_length=1, max_length=200)


class SlidesSuggestInput(BaseModel):
    source_text: str = Field(min_length=1, max_length=20000)
    count: int = Field(default=5, ge=1, le=8)
    provider: HermesProvider | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)


SlidesLength = Literal["short", "medium", "long"]


class SlidesExtendInput(BaseModel):
    source_text: str = Field(min_length=1, max_length=20000)
    topic: str = Field(min_length=1, max_length=300)
    # Length hint only — the model decides the exact slide count.
    length: SlidesLength = "medium"
    # Optional design summary extracted from the original deck (theme,
    # background, fonts) so new slides match its structure and tone.
    design_hint: str = Field(default="", max_length=2000)
    provider: HermesProvider | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)


class SlidesExportSlide(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    bullets: list[str] = Field(min_length=1, max_length=8)
    speaker_notes: str = Field(default="", max_length=2000)


class SlidesExportInput(BaseModel):
    original_filename: str = Field(min_length=1, max_length=200)
    topic: str = Field(min_length=1, max_length=300)
    slides: list[SlidesExportSlide] = Field(min_length=1, max_length=12)
    # Optional original .pptx bytes (base64): originals are kept and the new
    # slides reuse their layouts, backgrounds, and text styling.
    original_pptx_base64: str | None = Field(default=None, max_length=34_000_000)
    # Optional rendered original pages (PNG/JPEG data URLs or raw base64, for
    # PDF decks): each becomes a full-bleed image slide ahead of the new ones.
    original_images_base64: list[str] = Field(default_factory=list, max_length=60)


class HermesSettingsApply(BaseModel):
    """Persist Settings-pane Hermes choices to .env (takes effect on restart).

    The key becomes both the API's HERMES_API_KEY and the gateway's
    API_SERVER_KEY once the stack restarts, so it must already satisfy the
    native runner's minimum (>= 32 chars) or the next start would regenerate it.
    """

    key: str = Field(min_length=32, max_length=256)
    provider: HermesProvider | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)

