from __future__ import annotations

"""Step 1: basics. The student enters institution/program/year/graduation.

Program text maps to a discipline (overridable). Pure helper so the
API layer stays thin.
"""

from ..disciplines import classify_program


def discipline_for(program: str, override: str | None = None) -> str:
    """Return the explicit override, else the classified discipline."""
    if override:
        return override
    return classify_program(program or "")


def basics_complete(institution: str, program: str) -> bool:
    """Basics count as done once we know where/what the student studies."""
    return bool((institution or "").strip() or (program or "").strip())
