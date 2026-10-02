"""Hermes' interactive chat tools: ask the student a question with choice cards, and say onboarding is done.

Like Claude's ask-question tool, a question is a tool call instead of a JSON block the model has to append
to its reply text. Tool calls are what every provider is trained to get right; the old fenced
`waypoint-ui` block was skipped or malformed by NIM models, so students got options buried in prose.

The tool only stages UI on the student's running AgentRun (the grant is bound to it). run_agent attaches
it to the assistant message when the run completes, so a question never appears without its reply, and
a stopped or failed run shows nothing. Choices are data for the UI: a click is still checked by the
interaction endpoint, and only the student's selection (never the question) can become a fact.
"""
from __future__ import annotations

import json
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from .database import get_db
from .models import AgentRun, StudentProfile
from .schemas import ChatChoiceGroup, ChatMessageUi
from .tool_grants import AskGrant, student_for

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]

QUESTION_NOTE = (
    "Shown to the student as clickable cards under your reply. Finish now with one short lead-in sentence; "
    "do not list or repeat the options in your text, and do not ask another question in this reply."
)


class AskOption(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=280)
    opportunity_id: str | None = Field(default=None, max_length=36)


class AskFollowUp(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=500)


class AskInput(BaseModel):
    user_id: str | None = None
    question: str = Field(min_length=1, max_length=180)
    options: list[AskOption] = Field(default_factory=list, max_length=4)
    multi_select: bool = False
    follow_ups: list[AskFollowUp] = Field(default_factory=list, max_length=3)


class ReadyInput(BaseModel):
    user_id: str | None = None


def _slug(text: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "option"
    if not base[0].isalnum():
        base = f"o{base}"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base[:36]}-{n}", n + 1
    taken.add(slug)
    return slug


def _run_for(db: Session, grant) -> AgentRun:
    run = db.get(AgentRun, grant.agent_run_id) if grant.agent_run_id else None
    if run is None:
        raise HTTPException(403, "Questions can only be asked from a chat run")
    return run


def _staged(run: AgentRun) -> dict:
    try:
        return json.loads(run.ui_json) if run.ui_json else {}
    except json.JSONDecodeError:
        return {}


def build_ui(body: AskInput) -> dict:
    """Validated ChatMessageUi fields for one ask. Raises ValueError with a message the model can fix."""
    if not body.options and not body.follow_ups:
        raise ValueError("Give 2-4 options (or follow_ups); for an open question just ask it in your reply text")
    ui: dict = {}
    if body.options:
        if len(body.options) < 2:
            raise ValueError("Give at least two options, or ask the open question in your reply text")
        taken: set[str] = set()
        options = [{"id": _slug(item.title, taken), "title": item.title.strip(),
                    "description": (item.description or item.title).strip(), "opportunity_id": item.opportunity_id}
                   for item in body.options]
        count = len(options)
        group = {"mode": "multiple" if body.multi_select else "single", "prompt": body.question.strip(), "options": options,
                 "min_selections": 1, "max_selections": count if body.multi_select else 1}
        ui["choice_group"] = ChatChoiceGroup.model_validate(group).model_dump()
    if body.follow_ups:
        taken = set()
        ui["follow_ups"] = [{"id": _slug(item.label, taken), "label": item.label.strip(), "prompt": item.prompt.strip()}
                            for item in body.follow_ups]
    ChatMessageUi.model_validate(ui)
    return ui


@router.post("/internal/hermes/ask")
def ask_question(body: AskInput, db: Db, grant: AskGrant) -> dict:
    student_for(db, grant, body.user_id)
    run = _run_for(db, grant)
    try:
        ui = build_ui(body)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc)[:400]) from exc
    # One question per reply: a second ask replaces the first instead of stacking two card groups.
    run.ui_json = json.dumps({**_staged(run), **ui})
    db.commit()
    return {"success": True, "note": QUESTION_NOTE}


@router.post("/internal/hermes/onboarding/ready")
def ready_to_generate(body: ReadyInput, db: Db, grant: AskGrant) -> dict:
    student_id = student_for(db, grant, body.user_id)
    run = _run_for(db, grant)
    profile = db.get(StudentProfile, student_id)
    if profile is None or profile.onboarding_status != "chat":
        raise HTTPException(409, "Only for the onboarding chat")
    run.ui_json = json.dumps({**_staged(run), "ready_to_generate": True})
    db.commit()
    return {"success": True, "note": "The Generate my roadmap button is now shown. Reply with one or two sentences summarising what you learned."}


def merge_staged_ui(run: AgentRun, text_ui_json: str | None) -> str | None:
    """The reply's final UI: tool-staged UI wins over a legacy text block, which still fills gaps."""
    staged = _staged(run)
    if not staged:
        return text_ui_json
    merged = json.loads(text_ui_json) if text_ui_json else {}
    merged.update({key: value for key, value in staged.items() if value})
    try:
        return ChatMessageUi.model_validate(merged).model_dump_json()
    except ValidationError:
        return text_ui_json

