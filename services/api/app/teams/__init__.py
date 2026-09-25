from fastapi import APIRouter

from . import models  # noqa: F401  (registers the team tables with Base.metadata)
from .events import router as events_router

router = APIRouter()
router.include_router(events_router)
