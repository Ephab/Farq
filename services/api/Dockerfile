FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --extra cpu --no-dev
ENV PATH="/app/.venv/bin:$PATH"
COPY services/api/app ./app
COPY services/api/start.py ./start.py
COPY services/api/seed-roadmap.json ./seed-roadmap.json
COPY services/api/fixtures ./fixtures
CMD ["python", "start.py"]

