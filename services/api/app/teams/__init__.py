from fastapi import APIRouter

from . import models  # noqa: F401  (registers the team tables with Base.metadata)
from .events import router as events_router
from .teams import router as teams_router
from .chat import router as chat_router
from .tasks import router as tasks_router
from .docs import router as docs_router
from .presence import router as presence_router
from .state import router as state_router
from .proposals import router as proposals_router
from .hermes_tools import router as hermes_tools_router
from .notices import router as notices_router
from .activity import router as activity_router
from .export import router as export_router
from .demo import router as demo_router
from .imports import router as imports_router
from .cutover import router as cutover_router

router = APIRouter()
router.include_router(events_router)
router.include_router(teams_router)
router.include_router(chat_router)
router.include_router(tasks_router)
router.include_router(docs_router)
router.include_router(presence_router)
router.include_router(state_router)
router.include_router(proposals_router)
router.include_router(hermes_tools_router)
router.include_router(notices_router)
router.include_router(activity_router)
router.include_router(export_router)
router.include_router(demo_router)
router.include_router(imports_router)
router.include_router(cutover_router)
