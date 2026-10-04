"""Local-only tool for teams moved to the shared collaboration service.

    python scripts/legacy_cutover.py status
    python scripts/legacy_cutover.py reopen TEAM_ID --abandon-shared-copy

`reopen` makes the local copy writable again. Use it only when the shared project is being abandoned
(for example the pilot was rolled back): from then on the shared copy is stale, and anything done
there is not brought back. Archive the shared project from the shared service first. There is
deliberately no API route for this; it can be run only on the computer that holds the data.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "api"))

from app.database import SessionLocal  # noqa: E402
from app.teams.models import Team, TeamCutover  # noqa: E402


def status() -> list[tuple[str, str, str, str]]:
    with SessionLocal() as db:
        rows = []
        for cutover in db.query(TeamCutover).order_by(TeamCutover.moved_at).all():
            team = db.get(Team, cutover.team_id)
            rows.append((cutover.team_id, team.name if team else "(deleted)", cutover.central_team_id, cutover.moved_at.isoformat()))
        return rows


def reopen(team_id: str) -> bool:
    with SessionLocal() as db:
        cutover = db.get(TeamCutover, team_id)
        if cutover is None:
            return False
        db.delete(cutover)
        db.commit()
        return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("status")
    reopening = sub.add_parser("reopen")
    reopening.add_argument("team_id")
    reopening.add_argument("--abandon-shared-copy", action="store_true", required=True)
    args = parser.parse_args(argv)
    if args.action == "status":
        rows = status()
        for row in rows:
            print("\t".join(row))
        print(f"{len(rows)} moved team(s)")
        return 0
    if reopen(args.team_id):
        print("Reopened; this local copy is writable and the shared copy is now stale")
        return 0
    print("That team was not moved", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
