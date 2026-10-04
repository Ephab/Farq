"""Shared collaboration routes, including reviewed project descriptions; no personal backend imports."""
from fastapi import APIRouter
from . import activity, chat, docs, events, export, models, notices, presence, proposals, state, tasks, teams, imports

router = APIRouter()
for module in (teams, chat, tasks, docs, proposals, events, presence, state, activity, export, notices, imports):
    router.include_router(module.router)
