# Hermes architecture

## Runtime

```text
React/Vite (:5173)
       |
       v
FastAPI + SQLite (:8000) ---- authoritative students, facts, chat, roadmap versions
       |
       v
Hermes Gateway (:8642) ------ sessions, memory, skills, agent loop
       |
       +---- Gemini provider
       |
       +---- Farq project plugin ---- authenticated calls back to FastAPI /internal/hermes
```

HTTP is only the transport into Hermes. `POST /v1/runs` starts the full Hermes agent loop,
including its session, instructions, memory, reasoning, and tool calls. Farq does not import
Hermes internals because its documented gateway contract is a safer upgrade boundary.

## One chat turn

1. The UI saves a message through FastAPI.
2. FastAPI creates an `AgentRun`, supplies the Hermes thread session ID, and sends a unique
   idempotency key to `/v1/runs`.
3. `X-Hermes-Session-Key: farq:user:<id>` gives Hermes a stable per-student memory scope.
4. Hermes may call Farq tools several times before replying.
5. FastAPI polls the durable run and exposes simplified status events to the browser via SSE.
6. The final assistant message and run result are persisted in SQLite.

Failures are stored and shown. The current roadmap is never replaced with fake output.

## Memory ownership

Hermes owns conversational continuity and agent execution. Farq owns verified facts and
decisions. `farq_record_explicit_fact` accepts only direct statements or a branch the student
selected. Reusing a category/key supersedes the old fact without erasing its audit record.

This prevents fuzzy agent memory from becoming the only record of courses, achievements,
strengths, weaknesses, or career direction.

## Tool contracts

- `farq_get_student_context(user_id)` reads active verified facts.
- `farq_get_active_roadmap(user_id)` reads the active version, graph, and progress.
- `farq_record_explicit_fact(...)` records a direct statement or explicit choice.
- `farq_submit_roadmap_proposal(...)` validates and stores a pending revision.

The plugin calls only `/internal/hermes/*` endpoints with `FARQ_INTERNAL_TOKEN`. It never opens
SQLite. Hermes cannot accept proposals; the student-facing endpoint performs that transaction.

The `farq-student-coach` Hermes skill defines when these tools must be used, how explicit branch
choices become durable facts, and when Hermes must pause for a student decision. Its behavior can
be improved without changing the API or model provider.

## Roadmap safety

Proposals are operation lists: add, update, remove, move, or set dependencies. Before storage
and again before acceptance, FastAPI verifies node identity, known stages/dependencies, a DAG,
the current base version, and protection of completed/in-progress nodes. Acceptance creates a
new active version in one transaction. Rejection does not touch the roadmap.

## Adding a capability

1. Add and test a backend domain operation.
2. Add an authenticated internal endpoint containing all authorization and validation.
3. Register a narrowly described plugin tool that calls that endpoint.
4. Update `SOUL.md`, this document, and the threat model.
5. Never expose a database handle, shell, or generic arbitrary-URL tool as a shortcut.
