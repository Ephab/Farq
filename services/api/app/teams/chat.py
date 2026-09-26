from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .common import Db, iso, loads, require, require_team
from .events import emit
from .models import Decision, MessageReaction, TeamMember, TeamMessage
from .models import PollVote as PollVoteRow
from .policy import authorize

router = APIRouter()


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    reply_to_id: str | None = None
    poll_options: list[str] | None = Field(default=None, max_length=8)


class MessageEdit(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class PollVote(BaseModel):
    option: int = Field(ge=0)


class DecisionCreate(BaseModel):
    message_id: str


class SeenUpdate(BaseModel):
    seq: int = Field(ge=0)


def reactions_for(db: Session, message_ids: list[str]) -> dict[str, dict[str, list[str]]]:
    grouped: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    if message_ids:
        for reaction in db.scalars(select(MessageReaction).where(MessageReaction.message_id.in_(message_ids))).all():
            grouped[reaction.message_id][reaction.emoji].append(reaction.user_id)
    return {message_id: dict(emojis) for message_id, emojis in grouped.items()}


def votes_for(db: Session, message_ids: list[str]) -> dict[str, dict[str, int]]:
    grouped: dict[str, dict[str, int]] = defaultdict(dict)
    if message_ids:
        for vote in db.scalars(select(PollVoteRow).where(PollVoteRow.message_id.in_(message_ids))).all():
            grouped[vote.message_id][vote.user_id] = vote.option
    return dict(grouped)


def message_dict(message: TeamMessage, reactions: dict[str, list[str]] | None = None, votes: dict[str, int] | None = None) -> dict:
    """Poll tallies live in `poll_votes` (one row per voter); pass them in as `votes`."""
    deleted = message.deleted_at is not None
    metadata = None if deleted else loads(message.metadata_json, None)
    if message.kind == "poll" and metadata is not None:
        metadata = {**metadata, "votes": votes or {}}
    return {
        "id": message.id, "team_id": message.team_id, "author_user_id": message.author_user_id, "kind": message.kind,
        "content": "" if deleted else message.content,
        "metadata": metadata,
        "reply_to_id": message.reply_to_id, "visible_to_user_id": message.visible_to_user_id,
        "created_at": iso(message.created_at), "edited_at": iso(message.edited_at), "deleted": deleted,
        "reactions": reactions or {},
    }


def decision_dict(decision: Decision) -> dict:
    return {
        "id": decision.id, "team_id": decision.team_id, "text": decision.text,
        "source_message_id": decision.source_message_id, "pinned_by": decision.pinned_by, "created_at": iso(decision.created_at),
    }


def post_message(
    db: Session, team_id: str, author_user_id: str | None, content: str, *,
    kind: str = "text", metadata: dict | None = None, reply_to_id: str | None = None,
    visible_to_user_id: str | None = None, created_at: datetime | None = None,
) -> TeamMessage:
    """Store a message and emit `message.created`. The caller commits."""
    message = TeamMessage(
        team_id=team_id, author_user_id=author_user_id, kind=kind, content=content,
        metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata is not None else None,
        reply_to_id=reply_to_id, visible_to_user_id=visible_to_user_id,
    )
    if created_at is not None:
        message.created_at = created_at
    db.add(message)
    db.flush()
    emit(db, team_id, "message.created", author_user_id, message_dict(message), visible_to_user_id=visible_to_user_id, created_at=created_at)
    return message


def _visible_message(db: Session, message_id: str, user_id: str) -> TeamMessage:
    message = db.get(TeamMessage, message_id)
    if message is None or (message.visible_to_user_id and message.visible_to_user_id != user_id):
        raise HTTPException(404, "Message not found")
    return message


def _emit_edited(db: Session, message: TeamMessage, actor: str) -> dict:
    payload = message_dict(message, reactions_for(db, [message.id]).get(message.id), votes_for(db, [message.id]).get(message.id))
    emit(db, message.team_id, "message.edited", actor, payload, visible_to_user_id=message.visible_to_user_id)
    return payload


@router.post("/api/teams/{team_id}/messages", status_code=201)
def create_message(team_id: str, body: MessageCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Message is empty")
    if body.reply_to_id and _visible_message(db, body.reply_to_id, user.id).team_id != team.id:
        raise HTTPException(404, "Message not found")
    kind, metadata = "text", None
    if body.poll_options is not None:
        options = [option.strip()[:120] for option in body.poll_options if option.strip()]
        if len(options) < 2:
            raise HTTPException(422, "A poll needs at least two options")
        kind, metadata = "poll", {"options": options}
    message = post_message(db, team.id, user.id, content, kind=kind, metadata=metadata, reply_to_id=body.reply_to_id)
    db.commit()
    return message_dict(message)


def _own_message(db: Session, message_id: str, user) -> TeamMessage:
    message = _visible_message(db, message_id, user.id)
    authorize(db, user, require_team(db, message.team_id), "write")
    if message.author_user_id != user.id or message.deleted_at is not None:
        raise HTTPException(403, "Only the author can change this message")
    return message


@router.patch("/api/messages/{message_id}")
def edit_message(message_id: str, body: MessageEdit, db: Db, user: CurrentUser) -> dict:
    message = _own_message(db, message_id, user)
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Message is empty")
    message.content = content
    message.edited_at = now()
    payload = _emit_edited(db, message, user.id)
    db.commit()
    return payload


@router.delete("/api/messages/{message_id}")
def delete_message(message_id: str, db: Db, user: CurrentUser) -> dict:
    message = _own_message(db, message_id, user)
    message.deleted_at = now()
    emit(db, message.team_id, "message.deleted", user.id, {"id": message.id}, visible_to_user_id=message.visible_to_user_id)
    db.commit()
    return {"id": message.id, "deleted": True}


@router.post("/api/messages/{message_id}/reactions")
def toggle_reaction(message_id: str, body: ReactionToggle, db: Db, user: CurrentUser) -> dict:
    message = _visible_message(db, message_id, user.id)
    authorize(db, user, require_team(db, message.team_id), "write")
    if message.deleted_at is not None:
        raise HTTPException(409, "This message was deleted")
    existing = db.scalar(select(MessageReaction).where(
        MessageReaction.message_id == message.id, MessageReaction.user_id == user.id, MessageReaction.emoji == body.emoji,
    ))
    if existing is not None:
        db.delete(existing)
    else:
        db.add(MessageReaction(message_id=message.id, user_id=user.id, emoji=body.emoji))
    payload = {"message_id": message.id, "user_id": user.id, "emoji": body.emoji, "on": existing is None}
    emit(db, message.team_id, "reaction.toggled", user.id, payload, visible_to_user_id=message.visible_to_user_id)
    db.commit()
    return payload


@router.post("/api/messages/{message_id}/poll-vote")
def vote_in_poll(message_id: str, body: PollVote, db: Db, user: CurrentUser) -> dict:
    message = _visible_message(db, message_id, user.id)
    authorize(db, user, require_team(db, message.team_id), "write")
    if message.kind != "poll" or message.deleted_at is not None:
        raise HTTPException(409, "This message is not an open poll")
    metadata = loads(message.metadata_json, {})
    if body.option >= len(metadata.get("options", [])):
        raise HTTPException(422, "Unknown poll option")
    vote = db.scalar(select(PollVoteRow).where(PollVoteRow.message_id == message.id, PollVoteRow.user_id == user.id))
    if vote is None:
        db.add(PollVoteRow(message_id=message.id, user_id=user.id, option=body.option))
    else:
        vote.option = body.option
    db.flush()
    payload = _emit_edited(db, message, user.id)
    db.commit()
    return payload


@router.post("/api/teams/{team_id}/decisions", status_code=201)
def pin_decision(team_id: str, body: DecisionCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    message = _visible_message(db, body.message_id, user.id)
    if message.team_id != team.id or message.visible_to_user_id or message.deleted_at is not None:
        raise HTTPException(422, "Only visible team messages can become decisions")
    decision = Decision(team_id=team.id, text=message.content, source_message_id=message.id, pinned_by=user.id)
    db.add(decision)
    db.flush()
    emit(db, team.id, "decision.pinned", user.id, decision_dict(decision))
    db.commit()
    return decision_dict(decision)


@router.delete("/api/decisions/{decision_id}")
def remove_decision(decision_id: str, db: Db, user: CurrentUser) -> dict:
    decision = require(db, Decision, decision_id, "Decision")
    authorize(db, user, require_team(db, decision.team_id), "write")
    team_id = decision.team_id
    db.delete(decision)
    emit(db, team_id, "decision.removed", user.id, {"id": decision_id})
    db.commit()
    return {"id": decision_id, "removed": True}


@router.post("/api/teams/{team_id}/seen")
def mark_seen(team_id: str, body: SeenUpdate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
    member.last_seen_seq = max(member.last_seen_seq, body.seq)
    db.commit()
    return {"last_seen_seq": member.last_seen_seq}
