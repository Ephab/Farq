"""Bounded, deterministic fit from reviewed self-described fields only."""
import hashlib
import itertools
import json
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from .identity import CurrentUser, User
from .invitations import InviteRate
from .profiles import SharedProfile, DiscoveryPreference, Preferences, classroom
from .teams.common import Db, require
from .teams.models import Assignment, CourseEnrollment
from .teams.teams import team_for_assignment

router = APIRouter()
POLICY = "fit-v1"
POOL_LIMIT = 20
COMBINATION_LIMIT = 2000


class MatchInput(BaseModel):
    assignment_id: str


def tags(body, field):
    return {value.strip().casefold() for value in body.get(field, []) if value.strip()}


def rate_limit(db, user_id):
    key = hashlib.sha256(("matching:" + user_id).encode()).hexdigest()
    window = int(time.time()) // 3600
    row = db.get(InviteRate, key)
    if row is None:
        row = InviteRate(key=key, window=window, count=0)
        db.add(row)
    if row.window != window:
        row.window, row.count = window, 0
    row.count += 1
    db.commit()
    if row.count > 20:
        raise HTTPException(429, "Matching limit reached; try next hour")


def fit(bodies, preferences):
    skills = set().union(*(tags(body, "skills") for body in bodies))
    required = tags(preferences, "required_skills")
    if not required <= skills:
        return None
    languages = tags(preferences, "required_languages")
    if any(not languages <= tags(body, "languages") for body in bodies):
        return None
    minimum = preferences.get("min_hours")
    if minimum and any(body.get("hours_per_week") is None or body["hours_per_week"] < minimum for body in bodies):
        return None
    schedules = [set(body.get("meeting_slots", [])) for body in bodies]
    overlap = set.intersection(*schedules) if schedules else set()
    required_slots = set(preferences.get("required_meeting_slots", []))
    if required_slots and not overlap & required_slots:
        return None
    desired = tags(preferences, "desired_skills")
    coverage = sorted(desired & skills)
    complement = sorted(skills - tags(bodies[0], "skills"))
    interests = tags(bodies[0], "interests") & set().union(*(tags(body, "interests") for body in bodies[1:]))
    roles = set().union(*(tags(body, "roles") for body in bodies))
    score = 3 * len(coverage) + 2 * min(10, len(complement)) + 2 * min(5, len(interests)) + min(6, len(roles)) + min(8, len(overlap))
    return {"score": score, "factors": {"desired_skills_covered": coverage, "complementary_skills": complement,
            "shared_interests": sorted(interests), "role_variety": sorted(roles), "common_meeting_slots": sorted(overlap)},
            "missing": {"schedule_count": sum(not slots for slots in schedules),
                        "commitment_count": sum(body.get("hours_per_week") is None for body in bodies)}}


@router.post("/v1/classes/{class_id}/discovery/matches")
def matches(class_id: str, body: MatchInput, db: Db, user: CurrentUser):
    rate_limit(db, user.id)
    classroom(db, class_id, user.id)
    assignment = require(db, Assignment, body.assignment_id, "Assignment")
    if assignment.course_id != class_id:
        raise HTTPException(404, "Assignment not found")
    if team_for_assignment(db, assignment.id, user.id):
        raise HTTPException(409, "You already have a team for this assignment")
    own = db.get(SharedProfile, (class_id, user.id))
    if not own or not own.published_at or not json.loads(own.body_json).get("looking"):
        raise HTTPException(403, "Publish your profile and opt into discovery first")
    own_body = json.loads(own.body_json)
    saved = db.get(DiscoveryPreference, (class_id, user.id))
    preferences = json.loads(saved.body_json) if saved else Preferences().model_dump()
    size = preferences["team_size"]
    if size > assignment.team_size_max:
        raise HTTPException(422, "Desired team size exceeds the assignment limit")
    rows = db.execute(select(SharedProfile, User).join(User, User.id == SharedProfile.account_id)
                      .join(CourseEnrollment, (CourseEnrollment.user_id == User.id) & (CourseEnrollment.course_id == SharedProfile.class_id))
                      .where(SharedProfile.class_id == class_id, SharedProfile.account_id != user.id,
                             SharedProfile.published_at.is_not(None), User.disabled.is_(False), CourseEnrollment.role == "student")
                      .order_by(SharedProfile.account_id).limit(200)).all()
    candidates = []
    desired = tags(preferences, "desired_skills") | tags(preferences, "required_skills")
    for row, account in rows:
        profile = json.loads(row.body_json)
        if not profile.get("looking") or team_for_assignment(db, assignment.id, account.id):
            continue
        if preferences.get("min_hours") and (profile.get("hours_per_week") or 0) < preferences["min_hours"]:
            continue
        if not tags(preferences, "required_languages") <= tags(profile, "languages"):
            continue
        candidates.append({"account_id": account.id, "display_name": account.display_name, "version": row.version, "body": profile})
    candidates.sort(key=lambda candidate: (-len(tags(candidate["body"], "skills") & desired), candidate["account_id"]))
    pool = candidates[:POOL_LIMIT]
    results, explored = [], 0
    for group in itertools.islice(itertools.combinations(pool, size - 1), COMBINATION_LIMIT):
        explored += 1
        result = fit([own_body, *(candidate["body"] for candidate in group)], preferences)
        if result is not None:
            results.append(result | {"members": [{key: candidate[key] for key in ("account_id", "display_name", "version")} for candidate in group]})
    results.sort(key=lambda result: (-result["score"], [member["account_id"] for member in result["members"]]))
    return {"policy": POLICY, "own_version": own.version, "teams": results[:3], "eligible_candidates": len(candidates),
            "explored": explored, "bounded": len(candidates) > POOL_LIMIT or explored == COMBINATION_LIMIT,
            "notice": "Self-described profiles; results reserve no seats. Unknown availability is not a confirmed overlap."}


def opening_snapshot(db, team, opening, own, preferences):
    """Bind a result to current consent, membership, opening and private preferences."""
    from .team_profiles import TeamProfile
    from .teams.teams import _members
    members = sorted(_members(db, team.id), key=lambda member: member.user_id)
    bodies, versions = [], []
    for member in members:
        account = db.get(User, member.user_id)
        row = db.get(TeamProfile, (team.id, member.user_id))
        shared = bool(account and not account.disabled and row and row.published_at and row.discovery)
        bodies.append(json.loads(row.body_json) if shared else {})
        versions.append([member.user_id, row.version if row else 0, shared])
    snapshot = [POLICY, own.account_id, own.version, preferences, team.id, team.name, team.lead_user_id,
                opening.summary, opening.roles_json, opening.commitment, opening.expires_at.isoformat(), opening.closed, versions]
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    return bodies, sum(not version[2] for version in versions), digest


def matching_context(db, class_id, assignment_id, user_id):
    classroom(db, class_id, user_id)
    assignment = require(db, Assignment, assignment_id, "Assignment")
    if assignment.course_id != class_id:
        raise HTTPException(404, "Assignment not found")
    if team_for_assignment(db, assignment_id, user_id):
        raise HTTPException(409, "You already have a team for this assignment")
    own = db.get(SharedProfile, (class_id, user_id))
    if not own or not own.published_at or not json.loads(own.body_json).get("looking"):
        raise HTTPException(403, "Publish your profile and opt into discovery first")
    saved = db.get(DiscoveryPreference, (class_id, user_id))
    return assignment, own, json.loads(saved.body_json) if saved else Preferences().model_dump()


@router.post("/v1/classes/{class_id}/discovery/team-matches")
def existing_teams(class_id: str, body: MatchInput, db: Db, user: CurrentUser):
    from .openings import TeamOpening
    from .teams.common import team_archived, iso
    from .teams.models import Team
    from .teams.teams import _members, team_capacity
    from .models import now
    rate_limit(db, user.id)
    assignment, own, preferences = matching_context(db, class_id, body.assignment_id, user.id)
    rows = db.execute(select(TeamOpening, Team).join(Team, Team.id == TeamOpening.team_id)
                      .where(Team.assignment_id == assignment.id, TeamOpening.closed == "no", TeamOpening.expires_at > now())
                      .order_by(Team.id).limit(101)).all()
    results = []
    for opening, team in rows[:100]:
        places = team_capacity(team, assignment) - len(_members(db, team.id))
        if places <= 0 or team_archived(db, team):
            continue
        bodies, unknown, snapshot = opening_snapshot(db, team, opening, own, preferences)
        result = fit([json.loads(own.body_json), *bodies], preferences)
        if result is None:
            continue
        results.append(result | {"team_id": team.id, "team_name": team.name, "summary": opening.summary,
                                 "roles": json.loads(opening.roles_json), "commitment": opening.commitment,
                                 "places": places, "expires_at": iso(opening.expires_at),
                                 "unknown_profiles": unknown, "snapshot": snapshot})
    results.sort(key=lambda result: (-result["score"], result["team_id"]))
    return {"policy": POLICY, "bounded": len(rows) > 100, "teams": results[:3],
            "notice": "Only separately consented team summaries are used. Missing profiles are unknown. Target forming-team size does not filter existing teams. No seats reserved."}


def validate_match_snapshot(db, team, opening, user_id, snapshot):
    assignment = db.get(Assignment, team.assignment_id)
    _, own, preferences = matching_context(db, assignment.course_id, assignment.id, user_id)
    bodies, _, current = opening_snapshot(db, team, opening, own, preferences)
    if snapshot != current or fit([json.loads(own.body_json), *bodies], preferences) is None:
        raise HTTPException(409, "Match changed; refresh matches before requesting a place")
