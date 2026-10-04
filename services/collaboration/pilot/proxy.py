"""Allowlisting reverse proxy that puts the collaboration service behind ONE public address.

Tooling for a tunnel such as ngrok. It is not part of the central deployment artifact. It listens on loopback only; the
tunnel is the only thing that should connect to it.

Public routes (everything else is 404): /health/* and /v1/* go to the collaboration service. Paths are normalized before
matching (no `..`, backslashes, doubled or encoded slashes), request bodies are capped, account creation and token calls
are rate limited per client address, and streaming responses (live team events) are forwarded unbuffered.
"""
from __future__ import annotations

import collections
import os
import time
from urllib.parse import unquote

import httpx
from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

PUBLIC_PREFIXES = ("/v1/", "/health/")
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
MAX_BODY = 8 * 1024 * 1024
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding",
              "upgrade", "host", "content-length"}
# (bucket, path fragment, method, allowed per window, window seconds). Creating an account solves a proof of work and counts
# against a daily cap on the server; these are the per-address ceilings in front of that (generous enough for a class
# sharing one school network).
LIMITS = (
    ("device-register", "/v1/auth/register", "POST", 30, 3600),
    ("device-token", "/v1/auth/token", "POST", 120, 60),
    ("device-challenge", "/v1/auth/challenge", "POST", 240, 60),
)


def clean_path(raw: str) -> str | None:
    """The path only if it is plain: no traversal, backslash, empty segment or encoded separators."""
    decoded = unquote(raw)
    if not raw.startswith("/") or "\\" in decoded or "\x00" in decoded or "%" in decoded:
        return None
    if "//" in raw or "//" in decoded or any(part in {"..", "."} for part in decoded.split("/")):
        return None
    return raw


class Limiter:
    def __init__(self):
        self.hits: dict[tuple[str, str], collections.deque] = collections.defaultdict(collections.deque)

    def allow(self, client: str, bucket: str, limit: int, now: float | None = None, window_seconds: int = 60) -> bool:
        now = time.monotonic() if now is None else now
        window = self.hits[(client, bucket)]
        while window and window[0] <= now - window_seconds:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True


def client_address(request: Request) -> str:
    # The tunnel appends the real client last; earlier entries are client-supplied and ignored.
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def create_app(central: str, public_host: str, transport: httpx.AsyncBaseTransport | None = None) -> Starlette:
    base = central.rstrip("/")
    client = httpx.AsyncClient(timeout=httpx.Timeout(30, read=None), follow_redirects=False, transport=transport)
    limiter = Limiter()

    async def handle(request: Request) -> Response:
        raw = request.scope.get("raw_path", b"").decode("latin-1").split("?", 1)[0] or request.url.path
        path = clean_path(raw)
        if path is None or not path.startswith(PUBLIC_PREFIXES):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        if request.method not in METHODS:
            return JSONResponse({"detail": "Method not allowed"}, status_code=405)
        who = client_address(request)
        for bucket, fragment, method, limit, seconds in LIMITS:
            if fragment in path and request.method == method and not limiter.allow(who, bucket, limit, window_seconds=seconds):
                return JSONResponse({"detail": "Too many attempts; try again later"}, status_code=429, headers={"Retry-After": str(seconds)})
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_BODY:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY:
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        headers = {name: value for name, value in request.headers.items() if name.lower() not in HOP_BY_HOP}
        headers.update({"x-forwarded-for": who, "x-forwarded-proto": "https", "x-forwarded-host": public_host})
        url = base + path + (f"?{request.url.query}" if request.url.query else "")
        try:
            upstream = await client.send(client.build_request(request.method, url, headers=headers, content=bytes(body)), stream=True)
        except httpx.HTTPError:
            return JSONResponse({"detail": "The service is unavailable"}, status_code=502)
        response = StreamingResponse(upstream.aiter_raw(), status_code=upstream.status_code, background=BackgroundTask(upstream.aclose))
        # Copy headers verbatim, including repeated Set-Cookie and the original Content-Encoding.
        response.raw_headers = [(name.lower().encode("latin-1"), value.encode("latin-1"))
                                for name, value in upstream.headers.multi_items() if name.lower() not in HOP_BY_HOP]
        return response

    app = Starlette(routes=[Route("/{path:path}", handle, methods=sorted(METHODS))])
    app.state.client = client
    return app


def main() -> None:
    import uvicorn

    app = create_app(os.getenv("PILOT_CENTRAL_URL", "http://127.0.0.1:8100"), os.environ["PILOT_PUBLIC_HOST"])
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PILOT_PROXY_PORT", "8200")), proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
