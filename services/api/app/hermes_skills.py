"""Hermes skills: the built-in Waypoint skills, learned skills, and the skill-learning switch.

Built-in skills live in `.hermes/skills/waypoint-*` and are copied into the gateway's home on every
start. FastAPI also reads them here and puts the one a run needs straight into that run's
instructions, so the model never spends a `skill_view` round trip (which re-sends the whole agent
context) on every turn, and JSON-only prompts that forbid tool calls still get their skill.

Learned skills are the ones Hermes writes itself with `skill_manage`. config.yaml points
`skills.create_dir` at `<HERMES_HOME>/learned-skills`, so they never mix with the built-in copies
that provisioning replaces. They are shared by every student and team on this gateway, which is why
the `waypoint-memory` skill forbids personal details in them and Settings lets the person at this
computer read, turn off (move to `.archive/`, which Hermes never scans) or delete each one.
"""
from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from .connections import is_local, require_local
from .app_settings import get_setting, set_setting

router = APIRouter()

REPO_ROOT = Path(__file__).resolve().parents[3]
LEARNING_SETTING = "hermes_skill_learning"
# Tool iterations between Hermes' background "should this become a skill?" reviews when learning is on.
LEARNING_NUDGE_INTERVAL = 8

# Built-in skill -> the Waypoint actions that use it (labels are translated in the browser).
BUILTIN_SKILLS: dict[str, tuple[str, ...]] = {
    "waypoint-student-coach": ("coach",),
    "waypoint-memory": ("coach", "onboarding"),
    "waypoint-onboarding": ("onboarding", "folder"),
    "waypoint-roadmap-builder": ("roadmap",),
    "waypoint-project-coach": ("project",),
    "waypoint-quiz": ("quiz",),
    "waypoint-slides": ("slides",),
    "waypoint-mail-assistant": ("mail",),
    "waypoint-team-coach": ("team",),
    "waypoint-project-import": ("team_import",),
}


def skills_dir() -> Path:
    configured = os.getenv("WAYPOINT_SKILLS_DIR", "").strip()
    return Path(configured) if configured else REPO_ROOT / ".hermes" / "skills"


def hermes_home() -> Path:
    configured = os.getenv("WAYPOINT_HERMES_HOME", "").strip() or os.getenv("HERMES_HOME", "").strip()
    return Path(configured) if configured else REPO_ROOT / ".hermes-runtime"


def learned_dir() -> Path:
    return hermes_home() / "learned-skills"


FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


def _split(text: str) -> tuple[dict, str]:
    match = FRONTMATTER.match(text)
    if not match:
        return {}, text.strip()
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    return (meta if isinstance(meta, dict) else {}), text[match.end():].strip()


@lru_cache(maxsize=32)
def _builtin(name: str) -> tuple[dict, str]:
    path = skills_dir() / name / "SKILL.md"
    try:
        return _split(path.read_text(encoding="utf-8"))
    except OSError:
        return {}, ""


def skill_body(name: str) -> str:
    """The instructions of a built-in skill without its frontmatter ("" if it is missing)."""
    return _builtin(name)[1]


def with_skills(instructions: str, *names: str) -> str:
    """Run instructions with built-in skills already loaded, so the model never calls skill_view for them."""
    blocks = [instructions.strip()]
    for name in names:
        body = skill_body(name)
        if body:
            blocks.append(f"--- Skill `{name}` (already loaded for this run; do not call skill_view for it) ---\n{body}")
    return "\n\n".join(blocks)


# --- learned skills ------------------------------------------------------------------------------

def _learned_entries() -> list[dict]:
    root = learned_dir()
    if not root.is_dir():
        return []
    entries = []
    for path in sorted(root.rglob("SKILL.md")):
        relative = path.parent.relative_to(root)
        parts = relative.parts
        archived = bool(parts) and parts[0] == ".archive"
        if any(part.startswith(".") for part in (parts[1:] if archived else parts)):
            continue  # Hermes' own backups and locks, never a skill
        skill_id = "/".join(parts[1:] if archived else parts)
        if not skill_id:
            continue
        try:
            meta, body = _split(path.read_text(encoding="utf-8"))
            modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        entries.append({
            "id": skill_id,
            "name": str(meta.get("name") or parts[-1]),
            "description": str(meta.get("description") or ""),
            "enabled": not archived,
            "updated_at": modified.isoformat(),
            "size": len(body),
            "_path": path.parent,
        })
    return entries


def learned_skills() -> list[dict]:
    return [{k: v for k, v in entry.items() if not k.startswith("_")} for entry in _learned_entries()]


def _find_learned(skill_id: str) -> dict:
    match = next((entry for entry in _learned_entries() if entry["id"] == skill_id), None)
    if match is None:
        raise HTTPException(404, "Learned skill not found")
    # The id came from our own listing, but re-check containment before touching the disk.
    if not match["_path"].resolve().is_relative_to(learned_dir().resolve()):
        raise HTTPException(400, "Learned skill path is outside the learned-skills folder")
    return match


def _move(entry: dict, archived: bool) -> None:
    root = learned_dir()
    target = (root / ".archive" / entry["id"]) if archived else (root / entry["id"])
    if target.exists():
        raise HTTPException(409, "A skill with this name already exists there")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(entry["_path"]), str(target))


# --- the learning switch -------------------------------------------------------------------------

def learning_enabled() -> bool:
    return get_setting(LEARNING_SETTING) != "off"


def _runtime_config() -> Path:
    return hermes_home() / "config.yaml"


def config_writable() -> bool:
    path = _runtime_config()
    return path.is_file() and os.access(path, os.W_OK)


def apply_learning_setting() -> bool:
    """Write the switch into the gateway's runtime config.yaml. Hermes re-reads the file when it
    changes, so new runs follow it without a restart. False when the config is not ours to write
    (Docker mounts it read-only; there the checked-in value applies)."""
    if not config_writable():
        return False
    path = _runtime_config()
    try:
        config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return False
    skills = config.setdefault("skills", {})
    interval = LEARNING_NUDGE_INTERVAL if learning_enabled() else 0
    if skills.get("creation_nudge_interval") == interval:
        return True
    skills["creation_nudge_interval"] = interval
    temporary = path.with_suffix(".yaml.tmp")
    temporary.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
    os.replace(temporary, path)
    return True


def learning_note() -> str:
    """One line for run instructions, so the agent follows the switch even mid-session."""
    if learning_enabled():
        return ("Skill learning is ON: after working out a reusable procedure, you may save it with skill_manage, "
                "following the waypoint-memory rules (no personal details; never patch waypoint-* skills).")
    return "Skill learning is OFF: do not create or edit skills with skill_manage in this run."


# --- routes --------------------------------------------------------------------------------------

def _gateway_status() -> dict:
    from .hermes import HERMES_URL
    try:
        response = httpx.get(f"{HERMES_URL}/health", timeout=2.0)
        return {"reachable": response.status_code < 500}
    except httpx.HTTPError:
        return {"reachable": False}


@router.get("/api/hermes/skills")
def list_skills(request: Request) -> dict:
    builtin = []
    for name, actions in BUILTIN_SKILLS.items():
        meta, body = _builtin(name)
        if body:
            builtin.append({"id": name, "name": name, "description": str(meta.get("description") or ""), "actions": list(actions)})
    return {
        "can_edit": is_local(request),
        "learning": {"enabled": learning_enabled(), "applies_live": config_writable()},
        "gateway": _gateway_status(),
        "builtin": builtin,
        "learned": learned_skills(),
    }


@router.get("/api/hermes/skills/content")
def skill_content(source: str = Query(pattern="^(builtin|learned)$"), id: str = Query(min_length=1, max_length=200)) -> dict:
    if source == "builtin":
        if id not in BUILTIN_SKILLS or not skill_body(id):
            raise HTTPException(404, "Built-in skill not found")
        return {"id": id, "content": skill_body(id)}
    entry = _find_learned(id)
    try:
        _meta, body = _split((entry["_path"] / "SKILL.md").read_text(encoding="utf-8"))
    except OSError as exc:
        raise HTTPException(404, "Learned skill not found") from exc
    return {"id": id, "content": body}


class LearnedSkillRef(BaseModel):
    id: str


class LearningInput(BaseModel):
    enabled: bool


@router.post("/api/hermes/skills/learned/archive")
def archive_learned(body: LearnedSkillRef, request: Request) -> dict:
    require_local(request)
    entry = _find_learned(body.id)
    if entry["enabled"]:
        _move(entry, archived=True)
    return {"status": "off", "learned": learned_skills()}


@router.post("/api/hermes/skills/learned/restore")
def restore_learned(body: LearnedSkillRef, request: Request) -> dict:
    require_local(request)
    entry = _find_learned(body.id)
    if not entry["enabled"]:
        _move(entry, archived=False)
    return {"status": "on", "learned": learned_skills()}


@router.delete("/api/hermes/skills/learned")
def delete_learned(request: Request, id: str = Query(min_length=1, max_length=200)) -> dict:
    require_local(request)
    entry = _find_learned(id)
    shutil.rmtree(entry["_path"])
    return {"status": "deleted", "learned": learned_skills()}


@router.put("/api/hermes/skills/learning")
def set_learning(body: LearningInput, request: Request) -> dict:
    require_local(request)
    set_setting(LEARNING_SETTING, "on" if body.enabled else "off")
    return {"enabled": body.enabled, "applies_live": apply_learning_setting()}
