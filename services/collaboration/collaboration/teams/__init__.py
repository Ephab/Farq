"""Extracted human collaboration; personal imports and agent tooling are excluded."""
from fastapi import APIRouter
from . import activity, chat, docs, events, export, models, notices, presence, proposals, state, tasks, teams

router = APIRouter()
for module in (teams, chat, tasks, docs, proposals, events, presence, state, activity, export, notices):
    router.include_router(module.router)
