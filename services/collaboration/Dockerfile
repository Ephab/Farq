# Build from the root of the unpacked `waypoint-central.zip` (scripts/artifacts.py), never from a developer checkout:
#   docker build -f services/collaboration/Dockerfile -t waypoint-collaboration .
# The artifact holds only this service, the team Hermes plugin and its skill. Migrations are explicit:
#   docker run --rm --env-file collab.env waypoint-collaboration alembic upgrade head
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv
RUN useradd --system --uid 10001 --create-home waypoint
WORKDIR /srv/services/collaboration
COPY services/collaboration/pyproject.toml services/collaboration/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY services/collaboration/ ./
# team_hermes.py finds the skill at <repo root>/.hermes/skills (two levels above this service).
COPY .hermes/skills/waypoint-team-coach /srv/.hermes/skills/waypoint-team-coach
RUN uv sync --locked --no-dev && chown -R waypoint /srv

USER waypoint
ENV PATH="/srv/services/collaboration/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health/ready', timeout=4).status == 200 else 1)"
# TLS terminates at the reverse proxy; trust only its forwarded headers.
CMD ["uvicorn", "collaboration.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8100", "--proxy-headers", "--no-access-log"]
