from fastapi import APIRouter

from . import models  # noqa: F401  (registers the team tables with Base.metadata)
from .events import router as events_router
from .teams import router as teams_router
from .chat import router as chat_router
from .tasks import router as tasks_router
from .docs import router as docs_router
from .presence import router as presence_router
from .state import router as state_router

router = APIRouter()
router.include_router(events_router)
router.include_router(teams_router)
router.include_router(chat_router)
router.include_router(tasks_router)
router.include_router(docs_router)
router.include_router(presence_router)
router.include_router(state_router)
