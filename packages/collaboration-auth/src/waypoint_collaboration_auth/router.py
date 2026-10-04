"""Local routes the Waypoint web page calls to get a shared-server account and short-lived access tokens.

Loopback and the app's own origin only, plus a custom header a hostile website cannot send with a simple request, so no
other site or program can ask this computer for a token. There is no login: the first call creates the account, but only after the student has confirmed, once per server
address, that Group Projects will talk to that external server. The check lives here, not in the page.
"""
import ipaddress
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response

from .broker import AuthError, Config
from .device import DeviceBroker


def create_router(config: Config | None = None, broker=None, identity=None):
    """`identity(request) -> (local_student_id, display_name)` names whose shared account this is."""
    router = APIRouter(prefix="/api/collaboration/auth")
    config = config or Config.from_env()
    if identity is None:
        raise ValueError("A function that names the local student is required")
    instance = broker

    def context(request, response, require_consent=True):
        nonlocal instance
        if config is None:
            raise HTTPException(503, "Collaboration is not configured")
        try:
            local = ipaddress.ip_address(request.client.host).is_loopback
        except ValueError:
            local = False
        if not local or request.headers.get("origin") not in config.origins:
            raise HTTPException(403, "Open collaboration from the local Waypoint app")
        if request.headers.get("x-waypoint-collaboration") != "1":
            raise HTTPException(403, "Missing collaboration request header")
        if instance is None:
            try:
                instance = DeviceBroker(config)
            except Exception:
                raise HTTPException(503, "OS credential storage is unavailable") from None
        # One shared account per local student; the key lives in the OS vault and the browser never sees it.
        local_user, display_name = identity(request)
        if require_consent and not instance.consented(local_user):
            raise HTTPException(403, "Confirm the connection to the shared server first")
        instance.remember(local_user, display_name)
        response.headers["Cache-Control"] = "no-store"
        return instance, local_user

    @router.post("/status")
    def status(request: Request, response: Response):
        """Whether a shared server is configured and whether this student has agreed to connect to it."""
        if config is None:
            return {"configured": False}
        broker, user = context(request, response, require_consent=False)
        return {"configured": True, "server": urlsplit(config.api_origin).netloc, "consented": broker.consented(user)}

    @router.post("/consent")
    def consent(request: Request, response: Response):
        broker, user = context(request, response, require_consent=False)
        broker.consent(user)
        return {"consented": True}

    @router.delete("/consent")
    def withdraw(request: Request, response: Response):
        """Disconnect: later calls are refused until the student confirms again. The key and account are kept."""
        broker, user = context(request, response, require_consent=False)
        broker.withdraw(user)
        return {"consented": False}

    @router.post("/session")
    def session_info(request: Request, response: Response):
        broker, user = context(request, response)
        try:
            return {"account": broker.token(user)["account"], "api_origin": config.api_origin}
        except AuthError as error:
            raise HTTPException(503, str(error)) from None

    @router.post("/token")
    def token(request: Request, response: Response):
        broker, user = context(request, response)
        try:
            value = broker.token(user)
            return {"access_token": value["access_token"], "expires_at": value["expires_at"], "account_id": value["account"]["id"]}
        except AuthError as error:
            raise HTTPException(503, str(error)) from None

    @router.post("/logout")
    def logout(request: Request, response: Response):
        """Forget the cached token only. The key, and so the account, stays in the OS vault."""
        broker, user = context(request, response)
        return {"logged_out": broker.logout(user)}

    # Lets the local API's coach opt-in and team move reuse this exact loopback/origin/header check and broker.
    router.session_for = context
    return router
