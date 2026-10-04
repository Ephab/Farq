import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .config import Settings
from .database import database
from .identity import CurrentUser
from .teams import models as team_models  # noqa: F401 -- migration metadata
from . import invitations  # migration metadata and peer class routes
from . import openings
from . import lifecycle
from . import profiles
from . import matching
from . import team_profiles
from . import legacy_import
from . import device_auth


API_VERSION = 1
VERSION = re.compile(r"^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$")


def version_tuple(value: str | None) -> tuple[int, int, int] | None:
    match = VERSION.match(value or "")
    return tuple(int(part) for part in match.groups()) if match else None


class Me(BaseModel):
    id: str
    display_name: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine, sessions = database(settings)

    @asynccontextmanager
    async def lifespan(app):
        if settings.team_ai_enabled and app.state.team_worker is None:
            from .team_hermes import Worker
            app.state.team_worker = Worker(app.state.sessions, settings)
            app.state.team_worker.start()
        try:
            yield
        finally:
            if app.state.team_worker is not None:
                app.state.team_worker.close()
            engine.dispose()

    app = FastAPI(title="Waypoint collaboration", version="0.1.0", lifespan=lifespan)
    app.state.sessions = sessions
    app.state.settings = settings
    app.state.team_worker = None
    app.state.verifier = device_auth.DeviceVerifier(settings)
    app.include_router(device_auth.router)
    if settings.teams_enabled:
        from .teams import router as teams_router
        app.include_router(teams_router)
        app.include_router(invitations.router)
        app.include_router(openings.router)
        app.include_router(lifecycle.router)
        app.include_router(profiles.router)
        app.include_router(matching.router)
        app.include_router(team_profiles.router)
        app.include_router(legacy_import.router)
        if settings.team_ai_enabled:
            from . import hermes_tools
            app.include_router(hermes_tools.router)
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                       allow_credentials=False, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "Last-Event-ID", "X-Waypoint-Client-Version", "ngrok-skip-browser-warning"])

    minimum = version_tuple(settings.min_client_version)

    @app.middleware("http")
    async def no_store(request, call_next):
        path = request.url.path
        if minimum != (0, 0, 0) and path.startswith("/v1/") and path != "/v1/capabilities" and request.method != "OPTIONS":
            client = version_tuple(request.headers.get("x-waypoint-client-version"))
            if client is None or client < minimum:
                return JSONResponse({"detail": "Update Waypoint to keep using collaboration", "min_client_version": settings.min_client_version},
                                    status_code=426, headers={"Cache-Control": "no-store"})
        response = await call_next(request)
        response.headers["Cache-Control"] = ("no-store, no-transform" if response.headers.get("content-type", "").startswith("text/event-stream") else "no-store")
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health/live")
    def live():
        return {"status": "ok", "service": "waypoint-collaboration"}

    @app.get("/health/ready")
    def ready():
        try:
            with app.state.sessions() as db:
                revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                if revision != "0011_project_details":
                    return JSONResponse({"status": "not_ready"}, status_code=503)
                db.execute(text("SELECT id FROM accounts LIMIT 1"))
                if settings.teams_enabled:
                    db.execute(text("SELECT id FROM teams LIMIT 1"))
                    db.execute(text("SELECT seq FROM team_events LIMIT 1"))
        except SQLAlchemyError:
            return JSONResponse({"status": "not_ready"}, status_code=503)
        return {"status": "ok"}

    @app.get("/v1/me", response_model=Me)
    def me(user: CurrentUser):
        return Me(id=user.id, display_name=user.display_name)

    @app.get("/v1/capabilities")
    def capabilities(user: CurrentUser):
        return {"api_version": API_VERSION, "min_client_version": settings.min_client_version, "teams": settings.teams_enabled, "team_ai": settings.team_ai_enabled, "project_import": settings.team_ai_enabled, "discovery": settings.teams_enabled}

    return app
