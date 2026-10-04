"""The proxy exposes only the service API, with traversal protection, limits and unbuffered streams."""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

spec = importlib.util.spec_from_file_location("pilot_proxy", Path(__file__).resolve().parents[1] / "pilot" / "proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)

HOST = "pilot.example.dev"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


class Upstream:
    def __init__(self):
        self.calls = []
        self.down = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.down:
            raise httpx.ConnectError("refused")
        if request.url.path.endswith("/cookies"):
            return httpx.Response(200, headers=[("set-cookie", "a=1; Path=/"), ("set-cookie", "b=2; Path=/"), ("x-keep", "yes")], stream=httpx.ByteStream(b"ok"))
        if request.url.path.endswith("/stream"):
            async def events():
                yield b"data: one\n\n"
                yield b"data: two\n\n"
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=events())
        payload = {"path": request.url.path, "query": request.url.query.decode(), "method": request.method, "body": request.content.decode(),
                   "xfh": request.headers.get("x-forwarded-host"), "xfp": request.headers.get("x-forwarded-proto"),
                   "xff": request.headers.get("x-forwarded-for"), "auth": request.headers.get("authorization"), "host": request.headers.get("host")}
        return httpx.Response(200, headers={"content-type": "application/json"}, stream=httpx.ByteStream(json.dumps(payload).encode()))


@pytest.fixture
def world():
    upstream = Upstream()
    app = proxy.create_app("http://127.0.0.1:8100", HOST, transport=httpx.MockTransport(upstream))
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("203.0.113.9", 5000)), base_url="https://" + HOST)
    return client, upstream


async def test_service_paths_are_forwarded_with_forwarding_headers(world):
    client, upstream = world
    answer = await client.post("/v1/teams?x=1&y=two", content=b'{"name":"A"}', headers={"authorization": "Bearer t", "x-forwarded-for": "6.6.6.6, 203.0.113.9"})
    body = answer.json()
    assert answer.status_code == 200
    assert (body["path"], body["query"], body["method"], body["body"]) == ("/v1/teams", "x=1&y=two", "POST", '{"name":"A"}')
    assert body["auth"] == "Bearer t" and body["xfh"] == HOST and body["xfp"] == "https" and body["host"] == "127.0.0.1:8100"
    assert body["xff"] == "203.0.113.9"  # a client-supplied first entry is ignored; the tunnel's last entry is used
    assert (await client.get("/health/ready")).json()["path"] == "/health/ready"


@pytest.mark.parametrize("path", [
    "/", "/docs", "/openapi.json", "/admin/", "/realms/waypoint/protocol/openid-connect/auth", "/internal/hermes/teams/x/context", "/metrics", "/v1",
    "/v1/../admin/", "/v1/%2e%2e/admin/", "/v1/%2E%2E%2Fadmin", "//v1/me", "/v1//me", "/health/../docs",
])
async def test_everything_else_is_not_found_and_never_reaches_the_service(world, path):
    client, upstream = world
    assert (await client.get(path)).status_code == 404 and not upstream.calls


async def test_methods_are_limited(world):
    client, upstream = world
    assert (await client.request("TRACE", "/v1/me")).status_code == 405
    assert (await client.delete("/v1/teams/x")).status_code == 200
    assert len(upstream.calls) == 1


async def test_account_creation_is_limited_per_address_per_hour(world):
    client, upstream = world
    codes = [(await client.post("/v1/auth/register", content=b"{}")).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429]
    assert (await client.post("/v1/auth/token", content=b"{}")).status_code == 200  # separate bucket
    other = await client.post("/v1/auth/register", content=b"{}", headers={"x-forwarded-for": "198.51.100.77"})
    assert other.status_code == 200  # another real address has its own allowance


async def test_token_and_challenge_calls_have_their_own_ceilings(world):
    client, upstream = world
    assert [(await client.post("/v1/auth/token", content=b"{}")).status_code for _ in range(122)][118:] == [200, 200, 429, 429][:4]
    assert (await client.post("/v1/auth/challenge", content=b"{}")).status_code == 200


def test_limiter_window_expires():
    limiter = proxy.Limiter()
    assert [limiter.allow("c", "b", 2, now=t) for t in (0, 1, 2)] == [True, True, False]
    assert limiter.allow("c", "b", 2, now=61.5) is True
    assert [limiter.allow("h", "s", 1, now=t, window_seconds=3600) for t in (0, 3599, 3601)] == [True, False, True]


async def test_oversized_bodies_are_refused(world):
    client, upstream = world
    assert (await client.post("/v1/teams/import", content=b"x" * (proxy.MAX_BODY + 1))).status_code == 413

    async def chunks():
        for _ in range(3):
            yield b"y" * (proxy.MAX_BODY // 2)

    assert (await client.post("/v1/teams/import", content=chunks())).status_code == 413
    assert not upstream.calls


async def test_response_headers_cookies_and_streams_pass_through(world):
    client, upstream = world
    answer = await client.get("/v1/x/cookies")
    assert answer.headers.get_list("set-cookie") == ["a=1; Path=/", "b=2; Path=/"] and answer.headers["x-keep"] == "yes"
    stream = await client.get("/v1/teams/t/events/stream")
    assert stream.headers["content-type"].startswith("text/event-stream") and stream.text == "data: one\n\ndata: two\n\n"


async def test_a_dead_service_is_a_generic_502(world):
    client, upstream = world
    upstream.down = True
    answer = await client.get("/v1/me")
    assert answer.status_code == 502 and "refused" not in answer.text and "127.0.0.1" not in answer.text
