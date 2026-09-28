# Project setup import, batch proposals and lead override

Date: 2026-09-28. Extends `2026-09-25-group-projects-design.md`.

## 1. Goal

A team imports its project description (PDF, DOCX or pasted text). Hermes reads it and the team gets
its foundations — team brief, deliverables (with SRS/SDS/SPMP outlines), milestones with deadlines,
and rubric — in one vote. Two supporting changes ship with it:

- **Batch proposals.** Hermes can bundle many operations of different kinds into one proposal (e.g.
  compress eight tasks into three), applied all-or-nothing.
- **Lead override.** The team lead can force-accept or force-reject any open proposal.

Decisions taken during brainstorming: the imported brief is a *team-level overlay* on the shared
assignment brief (option C); the import produces brief, deliverables, milestones and rubric (not
charter or task split); the uploader reviews extracted rows before anything reaches the team; the
lead override covers team *and* personal proposals; the task balance rule becomes a warning.

## 2. Import flow

1. `POST /api/teams/{team_id}/imports` (member only; multipart `file` or form `text`, optional
   `provider`/`model`, `X-Hermes-Api-Key`). PDF via `sources/pdf_text.py`, DOCX via `python-docx`,
   plain text as is. Text is `redact()`ed and truncated to 30 000 characters. The file is discarded.
2. The redacted text is sent to `run_json_prompt("team-import", ...)`: a throwaway, **tool-less**
   session. The document is untrusted data; instructions inside it are ignored. It returns rows.
3. Rows are stored on a `team_imports` row with `status="review"` and returned to the uploader.
4. The uploader edits and ticks rows on the review screen, then
   `POST /api/imports/{id}/propose {items: [...]}` builds one `batch` proposal (§3) with
   `invoked_by=uploader`. The import becomes `proposed`. `POST /api/imports/{id}/discard` drops it.
   Only the uploader may propose; the uploader or the lead may discard.

Row shape: `{id, kind: brief|deliverable|milestone|criterion, data, source_quote (≤200 chars),
confidence: stated|inferred}`.

| kind | data |
| --- | --- |
| brief | `{problem, objective, scope, constraints[], tools[]}` |
| deliverable | `{key, title, due, doc_kind: srs|sds|spmp|null}` |
| milestone | `{title, due, deliverable_key}` |
| criterion | `{name, weight, description}` |

Deliverable and milestone rows whose date is missing or relative ("week 10") come back with
`due=null` and are flagged in the UI; the API rejects proposing a deliverable or milestone without a
real date. Hermes never invents a date. A picked date means the end of that day in the student's
time zone: the review screen converts it with `fromDateInput` like every other date picker; a bare
`YYYY-MM-DD` sent by another client falls back to 23:59 UTC. Milestones whose title already exists
in the team are skipped when building the batch.

Ticked rows become batch operations: `brief` (first brief row), `deliverables` (all deliverable
rows), `milestones` (all milestone rows), `rubric` (all criterion rows). Empty groups are omitted.

## 3. Batch proposals

New proposal kind `batch`: `{ops: [{kind, payload}] (1..25), rationale}`. Allowed op kinds: every
existing kind except `batch`, plus the new ones below.

- **Validation** runs the ops in a SQLAlchemy savepoint: for each op, `check()` then apply, in order,
  so later ops see earlier ones; the savepoint is always rolled back. Any `ProposalError` rejects the
  whole batch with the op index in the message.
- **Scope**: if every op is personal for the same member, the batch is personal for that member;
  otherwise it is a team vote.
- **Apply** repeats the same sequence for real inside a savepoint. If any op no longer fits, the
  savepoint is rolled back and the proposal becomes `stale` — never half-applied.

New op kinds (also valid as standalone proposals):

- `task_merge`: `{task_ids (2..10, all to-do), into: {title, description, estimate_points (1..8),
  assignee_id|null, milestone_id|null}, rationale}`. The first task is kept and rewritten; the rest
  are removed and their dependents are re-pointed at the kept task. Team scope.
- `brief`: `{problem, objective, scope, constraints[], tools[]}` → `team.brief_json`. Team scope.
- `deliverables`: `{deliverables: [{key, title, due, doc_kind}]}` → `team.deliverables_json`
  (replaces); a `doc_kind` with no existing document of that kind creates its outline. Team scope.
- `rubric`: `{criteria: [{name, weight, description}]}` → `team.rubric_json`. Team scope.

`ReorgChange` also accepts `description` and `milestone_id`.

**Balance becomes a warning.** `task_split`, `task_reorganize`, `task_merge` and `batch` no longer
reject an unbalanced board. After simulating the proposal, the open points per member are compared
with the existing tolerance; any imbalance is stored on the proposal (`warnings_json`) and shown on
the card. The team (or the lead) decides. "Every member gets at least one task" still applies to a
fresh `task_split`.

## 4. Team brief overlay

New `teams` columns: `brief_json`, `deliverables_json`, `rubric_json` (default empty). `team_dict`
returns `project: {brief, deliverables, rubric}` (the team's own values) next to `assignment`.
Consumers show the team value where set and fall back to the assignment's. Hermes' team context
contains both, labelled. Assignment rows are never written by a team.

## 5. Lead override

`POST /api/proposals/{id}/accept|reject` accept the lead for any `pending` or `awaiting_lead`
proposal, team or personal. When the lead decides a proposal that is not otherwise theirs to decide
(a pending team vote, or a personal proposal for another member), `decided_via="lead_override"` is
stored and included in the `proposal.applied|rejected` event, so the team and the instructor see it.
Enforced in the API. The card shows "Accept now" / "Reject" to the lead only.

## 6. Hermes

- New tool `waypoint_propose_batch(team_id, run_id, summary, rationale, ops)`.
- `waypoint_propose_tasks` gains kind `task_merge`.
- The team-coach skill: prefer one batch over many small proposals; compress with `task_merge`;
  balance is advisory — explain any imbalance in the rationale instead of shrinking the plan.

## 7. Events

`import.created|proposed|discarded` (payload: import dict), `team.updated` with `project` for the
brief/deliverables/rubric ops. Existing events for tasks, milestones and documents are reused.

## 8. Testing

Backend (pytest): import extraction with a stubbed `run_json_prompt` (PDF/DOCX/text, redaction,
file not stored, rows returned); propose builds the right batch, rejects undated milestones, skips
duplicate milestones; batch validation/scope/atomic apply/stale; `task_merge` (dependents
re-pointed, non-to-do rejected); balance warning instead of rejection; lead override on team and
personal proposals, non-lead still blocked; plugin tool shaping. Frontend: `npm run build`.

## 9. Out of scope

Charter and task split from the import (a follow-up suggestion), re-running extraction on an
existing import, storing the source document, instructor-side imports.
