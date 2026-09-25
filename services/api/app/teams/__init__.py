from fastapi import APIRouter

from . import models  # noqa: F401  (registers the team tables with Base.metadata)
from .events import router as events_router
from .teams import router as teams_router
from .chat import router as chat_router
from .tasks import router as tasks_router

router = APIRouter()
router.include_router(events_router)
router.include_router(teams_router)
router.include_router(chat_router)
router.include_router(tasks_router)
