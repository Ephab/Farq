# Moving a local team to the shared collaboration service

Status: implemented behind the pilot flags. Applies only to teams that already exist in a student's local
SQLite database. New teams created on the shared service never need this.

## Principles

- **Opt-in and explicit.** Nothing is uploaded automatically. The team lead previews, then confirms.
- **One way, no dual writes.** After a move the local copy is read-only (`409` on every write, including
  Hermes runs). The shared service never writes back to a student machine.
- **Consent per person.** The lead becomes the only member of the new shared project. Teammates join through
  ordinary invitations or codes and may decline. Their old tasks and section ownership arrive unassigned with a
  plain-text note of the former owner.
- **Minimum data.** Moved: name, the team's edited assignment brief, project brief/deliverables/rubric (the assignment's, when the team has
  none of its own), milestones, tasks (status, estimate, dependencies, milestone links), decisions, document
  sections. Not moved: chat, reactions, polls, proposals, Hermes runs, activity events, and anything from a
  personal profile: student facts, roadmaps, evidence, mail, memory.
- **Stable and idempotent.** Shared IDs are uuid5 of (importer, kind, source team, local id). A second move of
  the same team by the same person is refused (`409`) and names the existing shared project; if an earlier
  attempt succeeded centrally but the local freeze failed, retrying completes the freeze.
- **Bounded.** At most 500 tasks, 300 sections, 60 milestones, 200 decisions, 12 documents per team and five
  moves per person per day; all fields are length-limited and validated before anything is written.

## Student flow

1. Sign in to collaboration (Group Projects, shared mode).
2. On the local team, the lead chooses **Preview move to shared service**. The app builds the bundle on this
   computer, sends it with `dry_run: true`, and shows counts, what is excluded and who must be invited.
3. The lead ticks the confirmation and chooses **Move team**. The service creates the project; the app records
   `team_cutovers` locally and freezes the team.
4. Open the shared project and invite teammates.

## Operator notes

- Needs service migration `0009_legacy_import` (table `legacy_imports`) and `COLLAB_TEAMS_ENABLED=true`.
- The new project emits a single `team.imported` event; history is not replayed as individual events.
- Bundles are validated against the same limits regardless of client. The service trusts the importer only for
  their own team content; it cannot verify that the local lead flag was honest, so the importer is simply the
  lead of a project only they belong to.
- Back up before a bulk rollout (`services/collaboration/scripts/backup.py`).

## Rollback

- **Before confirming:** nothing changed; close the dialog.
- **After a move, the pilot is abandoned:** archive the shared project from the shared service (lead), then on
  each affected computer run `python scripts/legacy_cutover.py reopen TEAM_ID --abandon-shared-copy`. The
  local copy becomes writable again and the shared copy is stale; anything done only on the shared service is
  not brought back. There is intentionally no API route for reopening.
- **Inspect:** `python scripts/legacy_cutover.py status` lists moved teams.
- Local data is never deleted by a move, so it remains the rollback source.

## Tests

`services/collaboration/tests/test_legacy_import.py` (dry run writes nothing, sole-member lead, no assignment of
others, stable per-importer IDs, validation, caps) and `services/api/tests/test_team_cutover.py` (bundle
contents exclude chat and personal data, confirm gating, freeze, central refusals, crash recovery, no reopen
route).
