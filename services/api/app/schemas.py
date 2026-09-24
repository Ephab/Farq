from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


FactCategory = Literal["interest", "goal", "course", "skill", "strength", "weakness", "achievement", "preference"]
HermesProvider = Literal["gemini", "nim", "hf"]
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
    # Evidence item ids that justify a node (e.g. a passed course marking it done).
    evidence: list[str] = Field(default_factory=list)
    rationale: str = ""


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


# Keep in sync with src/components/roadmap/roadmap-icons.ts.
ROADMAP_ICONS = frozenset({
    "code", "grid", "chart", "brain", "image", "waves", "scan", "aperture", "layers", "network",
    "target", "rocket", "database", "shapes", "gauge", "wrench", "scan-eye", "zap", "spline",
    "video", "sparkles", "focus", "boxes", "clapperboard", "eye", "milestone", "orbit",
    "microscope", "cpu", "cloud", "camera", "trophy", "book", "scale", "stethoscope", "heart",
    "briefcase", "graduation", "calculator", "flask", "pen", "users", "route", "file", "building",
    "globe", "landmark", "hammer", "cog", "lightbulb",
})

MAX_GENERATED_STAGES = 8
MAX_GENERATED_NODES = 40


def validate_generated(snapshot: RoadmapSnapshot, confirmed_evidence: set[str]) -> RoadmapSnapshot:
    """Stricter checks for a whole model-generated roadmap.

    RoadmapSnapshot already guarantees unique node ids, known stages and deps,
    and a DAG. Here we also require a consistent stage layout, bounded size, and
    known icons. A node may only start `done` when it cites evidence the student
    confirmed; anything else is reset rather than trusted.
    """
    stage_ids = [stage.id for stage in snapshot.stages]
    if len(stage_ids) != len(set(stage_ids)):
        raise ValueError("Roadmap contains duplicate stage IDs")
    if not 2 <= len(snapshot.stages) <= MAX_GENERATED_STAGES:
        raise ValueError(f"Roadmap must have between 2 and {MAX_GENERATED_STAGES} stages")
    if not 4 <= len(snapshot.nodes) <= MAX_GENERATED_NODES:
        raise ValueError(f"Roadmap must have between 4 and {MAX_GENERATED_NODES} nodes")
    by_stage = {stage.id: [node.id for node in snapshot.nodes if node.stageId == stage.id] for stage in snapshot.stages}
    for stage in snapshot.stages:
        if not by_stage[stage.id]:
            raise ValueError(f"Stage {stage.id} has no nodes")
        # The canvas only renders ids listed in nodeIds, so rebuild the list in
        # the model's order and append any node it forgot to list.
        ordered = [node_id for node_id in stage.nodeIds if node_id in by_stage[stage.id]]
        ordered += [node_id for node_id in by_stage[stage.id] if node_id not in ordered]
        stage.nodeIds = list(dict.fromkeys(ordered))
    for node in snapshot.nodes:
        if node.icon not in ROADMAP_ICONS:
            node.icon = "target"
        node.evidence = [item for item in node.evidence if item in confirmed_evidence]
        if node.status != "not-started" and not node.evidence:
            node.status = "not-started"
        if node.status == "in-progress":
            node.status = "not-started"
    return snapshot


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
    source_kind: Literal["chat", "branch", "onboarding"] = "chat"


Discipline = Literal["cs", "engineering", "medicine", "law", "business", "sciences", "design", "other"]
SourceKind = Literal["transcript_pdf", "cv_pdf", "linkedin_pdf", "linkedin_zip", "github", "folder", "portfolio_url", "orcid"]
EvidenceKind = Literal["course", "project", "skill", "experience", "certificate", "publication", "activity", "education"]


class StudentCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class ProfileUpdate(BaseModel):
    institution: str | None = Field(default=None, max_length=200)
    program: str | None = Field(default=None, max_length=200)
    discipline: Discipline | None = None
    year_label: str | None = Field(default=None, max_length=80)
    grad_target: str | None = Field(default=None, max_length=80)
    onboarding_status: Literal["basics", "sources", "review", "chat"] | None = None


class SourceCreate(BaseModel):
    kind: SourceKind
    # username / path / url / orcid, validated per kind in app.sources.
    value: str = Field(default="", max_length=500)
    purpose: Literal["projects", "coursework"] | None = None


class EvidenceIn(BaseModel):
    kind: EvidenceKind
    title: str = Field(min_length=1, max_length=240)
    data: dict[str, Any] = Field(default_factory=dict)
    source_ref: str = Field(default="", max_length=500)
    fingerprint: str | None = Field(default=None, max_length=300)


class EvidenceSubmit(BaseModel):
    user_id: str
    source_id: str
    items: list[EvidenceIn] = Field(min_length=1, max_length=200)


class EvidenceDecision(BaseModel):
    confirm: list[str] = Field(default_factory=list, max_length=500)
    dismiss: list[str] = Field(default_factory=list, max_length=500)
    # Optional student edits to a title before confirming.
    titles: dict[str, str] = Field(default_factory=dict)


class GenerateInput(BaseModel):
    provider: HermesProvider | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)


class AcceptInput(BaseModel):
    # Only for `initial` proposals: node ids the student unticked from `done`.
    not_done: list[str] = Field(default_factory=list, max_length=MAX_GENERATED_NODES)


class ChatInput(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    provider: HermesProvider | None = None
    # Optional per-run model override. Allowlisted in app.hermes so the
    # gateway /v1/runs payload can switch models without mutating config.
    model: str | None = Field(default=None, min_length=1, max_length=200)


class ResetInput(BaseModel):
    confirm: Literal["RESET"]


class RewindInput(BaseModel):
    # Edit-and-resend: delete this user message and everything after it so
    # the edited prompt restarts the thread from that point (no duplication).
    message_id: str = Field(min_length=1, max_length=36)


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
    # Optional student whose verified profile + active roadmap are injected
    # server-side as prompt data. Omitted/unknown => deck-only suggestions.
    student_id: str | None = Field(default=None, min_length=1, max_length=120)


SlidesLength = Literal["short", "medium", "long"]


class SlidesExtendInput(BaseModel):
    source_text: str = Field(min_length=1, max_length=20000)
    topic: str = Field(min_length=1, max_length=300)
    # Length hint only — the model decides the exact slide count.
    length: SlidesLength = "medium"
    # Optional design summary extracted from the original deck (fonts, colors,
    # layout density, visuals) so new slides match its structure, tone, and
    # visual habits. Styling itself is applied locally at export/preview.
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

