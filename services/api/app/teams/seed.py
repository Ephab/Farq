"""Idempotent demo world for Group Projects: two courses, eight students, one
instructor and Group 1 (id team-falcon) halfway through SWE 363 (spec §11)."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import User
from ..models import Student, StudentFact, StudentProfile
from .chat import decision_dict, message_dict
from .docs import OUTLINES, document_dict, section_dict
from .events import emit
from .models import (
    Assignment, Course, CourseEnrollment, Decision, DocSection, MessageReaction, Milestone, PollVote, Task, Team, TeamDocument,
    TeamMember, TeamMessage,
)
from .tasks import milestone_dict, task_dict

INSTRUCTOR_ID = "demo-instructor"
UTC = timezone.utc

# id: (name, program, year, {fact category: [values]}). demo-student already
# exists (created at startup) and keeps whatever profile it has.
STUDENTS: dict[str, tuple[str, str, str, dict[str, list[str]]]] = {
    "demo-student": ("Demo Student", "Software Engineering", "Year 3", {}),
    "demo-sara": ("Sara Alharbi", "Software Engineering", "Year 3", {"skill": ["Python", "Computer vision"], "goal": ["Become an ML engineer"]}),
    "demo-ali": ("Ali Alqahtani", "Software Engineering", "Year 3", {"skill": ["Node.js", "REST APIs"], "goal": ["Backend internship next summer"]}),
    "demo-noura": ("Noura Alshehri", "Software Engineering", "Year 3", {"skill": ["Figma", "React"], "goal": ["Product design career"]}),
    "demo-omar": ("Omar Alzahrani", "Computer Science", "Year 4", {"skill": ["PyTorch", "Data analysis"], "goal": ["Graduate research in NLP"]}),
    "demo-reem": ("Reem Aldossari", "Computer Science", "Year 3", {"skill": ["SQL", "Data pipelines"], "goal": ["Data engineering"]}),
    "demo-faisal": ("Faisal Alotaibi", "Software Engineering", "Year 3", {"skill": ["Java", "Testing"], "goal": ["QA automation"]}),
    "demo-lama": ("Lama Alghamdi", "Computer Science", "Year 4", {"skill": ["Kotlin", "Android"], "goal": ["Start a mobile startup"]}),
}
SWE_STUDENTS = ["demo-student", "demo-sara", "demo-ali", "demo-noura", "demo-omar", "demo-reem", "demo-faisal", "demo-lama"]
ML_STUDENTS = ["demo-student", "demo-sara", "demo-omar", "demo-reem", "demo-lama"]
FALCON = ["demo-student", "demo-sara", "demo-ali", "demo-noura"]

SWE_BRIEF = {
    "title": "Campus web application",
    "problem": "Pick one real problem students face on campus and solve it end to end with a web application.",
    "objective": "Deliver a working, documented web application built as a team using a disciplined software process.",
    "deliverables": ["Software Requirements Specification (SRS)", "Software Design Specification (SDS)", "Software Project Management Plan (SPMP)", "Working application and final demo"],
    "milestones": ["SRS by week 7", "SDS by week 10", "Final demo in week 15"],
    "constraints": ["Teams of 3 to 4", "Use Git with pull requests"],
    "tools": ["Git", "Any web stack"],
    "resources": [],
    "rubric": [
        {"id": "requirements", "title": "Requirements quality", "description": "Complete, testable, traceable requirements in the SRS.", "weight": 25},
        {"id": "design", "title": "Design", "description": "Architecture and design decisions justified in the SDS.", "weight": 25},
        {"id": "implementation", "title": "Implementation", "description": "Working features that satisfy the requirements.", "weight": 30},
        {"id": "process", "title": "Process and teamwork", "description": "Plan followed, work shared fairly, decisions recorded.", "weight": 20},
    ],
}
ML_BRIEF = {
    "title": "Applied machine learning project",
    "problem": "Choose a dataset with a real-world question and build a model that answers it responsibly.",
    "objective": "Frame, train, evaluate and explain a model, including its limitations.",
    "deliverables": ["Project proposal", "Final report", "Reproducible notebook or repository"],
    "milestones": ["Proposal by week 6", "Report by week 15"],
    "constraints": ["Teams of 2 to 3", "Document data provenance"],
    "tools": ["Python", "scikit-learn or PyTorch"],
    "resources": [],
    "rubric": [
        {"id": "framing", "title": "Problem framing", "description": "Clear question, suitable data and metrics.", "weight": 25},
        {"id": "method", "title": "Method", "description": "Sound modelling and validation choices.", "weight": 35},
        {"id": "results", "title": "Results and analysis", "description": "Honest evaluation including failure cases.", "weight": 25},
        {"id": "communication", "title": "Communication", "description": "Readable report that explains decisions.", "weight": 15},
    ],
}

DEMO_TEAM_ID = "team-falcon"  # Group 1; the id predates the rename and existing databases use it

FALCON_CHARTER = {
    "goal": "A lost-and-found web app for our campus, live by the final demo.",
    "roles": {"demo-student": "Lead · requirements", "demo-sara": "Research · data", "demo-ali": "Backend", "demo-noura": "UI/UX"},
    "working_agreement": ["Reply in the chat within 24 hours", "Move your card when you start or finish", "Pin every decision"],
    "meetings": "Tuesdays 8pm",
}

# A chat that shows off the features: grouped messages, replies, @mentions, a Hermes slash
# command, polls with votes, reactions and a pinned decision. Keys: days ago, by (None for
# Hermes), text; optional reply (index), poll (options), votes, react, decision, seen.
MINUTE = 1 / 1440
FALCON_CHAT: list[dict] = [
    {"days": 9.0, "by": "demo-student", "text": "Hi all! Group 1 is official 🎉", "react": {"🎉": ["demo-sara", "demo-ali", "demo-noura"]}},
    {"days": 9.0 - MINUTE, "by": "demo-student", "text": "Lost-and-found app for campus? Someone loses something every week."},
    {"days": 8.9, "by": "demo-sara", "text": "Yes! I lost my calculator twice this term 😅", "reply": 1, "react": {"😂": ["demo-ali"]}},
    {"days": 8.8, "by": "demo-ali", "text": "I'm in. I can take the backend."},
    {"days": 8.8 - MINUTE, "by": "demo-ali", "text": "FastAPI if nobody minds, I used it last term."},
    {"days": 8.7, "by": "demo-noura", "text": "I'll do the UI and wireframes 🎨"},
    {"days": 8.6, "by": "demo-student", "text": "Where should we deploy the demo?", "poll": ["Render", "Railway", "University server"],
     "votes": {"demo-student": 0, "demo-sara": 0, "demo-ali": 0, "demo-noura": 1}},
    {"days": 8.5, "by": "demo-student", "text": "Stack: React + FastAPI, deployed on Render (3 of 4 votes). Pinning this as our decision.",
     "decision": True, "react": {"👍": ["demo-sara", "demo-ali", "demo-noura"]}},
    {"days": 7.0, "by": "demo-sara", "text": "I interviewed 3 students at the library. Notes are in SRS §1.2."},
    {"days": 7.0 - MINUTE, "by": "demo-sara", "text": "@Hermes can you pull the common pain points out of my notes?"},
    {"days": 6.8, "by": None, "reply": 9, "text": "Nice work, Sara. Across your interviews the most common pain point is not knowing where to hand in found items. That's a strong core requirement for §3.2."},
    {"days": 5.0, "by": "demo-ali", "text": "Started the use cases for reporting and claiming an item."},
    {"days": 5.0 - MINUTE, "by": "demo-ali", "text": "@Noura can you check the claim flow matches your wireframes?"},
    {"days": 4.2, "by": "demo-noura", "reply": 12, "text": "Yes! The report screen is halfway done, I'll share it tonight.", "react": {"👍": ["demo-ali"]}},
    {"days": 3.2, "by": "demo-student", "text": "/standup"},
    {"days": 3.2 - MINUTE, "by": None, "reply": 14, "text": (
        "**Stand-up, week 2**\n\n"
        "- **Sara**: finished the library interviews. Next: the data model (ERD).\n"
        "- **Ali**: use cases for reporting and claiming are in progress.\n"
        "- **Noura**: report screen wireframes are halfway.\n"
        "- **Demo**: non-functional requirements are waiting on Ali's use cases.\n\n"
        "Question for everyone: when can you meet to review the SRS draft?")},
    {"days": 3.1, "by": "demo-student", "text": "When can everyone meet this week?"},
    {"days": 3.0, "by": "demo-sara", "text": "Tuesday after 8pm works for me"},
    {"days": 2.9, "by": "demo-ali", "text": "Tuesday 8pm 👍", "seen": True},
    {"days": 1.2, "by": "demo-noura", "text": "هل نحتاج صفحة للمشرفين في النسخة الأولى؟"},
    {"days": 1.1, "by": "demo-sara", "reply": 19, "text": "Good question. Let's decide after the use cases are done."},
    {"days": 0.9, "by": "demo-noura", "text": "Admin page in the first version?", "poll": ["Yes, basic moderation", "No, after the demo"],
     "votes": {"demo-sara": 1, "demo-noura": 0}},
]
DECISION_INDEX = next(index for index, item in enumerate(FALCON_CHAT) if item.get("decision"))
LAST_SEEN_INDEX = next(index for index, item in enumerate(FALCON_CHAT) if item.get("seen"))  # demo-student has read up to here

# (id, title, status, assignee, points, milestone, depends_on, created days ago, moved days ago or None)
FALCON_TASKS = [
    ("t-falcon-charter", "Agree on the project charter", "done", "demo-student", 1, None, [], 8.6, 8.2),
    ("t-falcon-interviews", "Interview 3 students about lost items", "done", "demo-sara", 2, "ms-falcon-srs", [], 8.0, 7.0),
    ("t-falcon-usecases", "Draft use cases for reporting and claiming items", "doing", "demo-ali", 3, "ms-falcon-srs", [], 7.9, 5.0),
    ("t-falcon-wireframes", "Wireframe the report and search screens", "doing", "demo-noura", 3, "ms-falcon-srs", [], 7.9, 4.2),
    ("t-falcon-nfr", "List non-functional requirements", "todo", "demo-student", 2, "ms-falcon-srs", ["t-falcon-usecases"], 7.8, None),
    ("t-falcon-erd", "Sketch the data model (ERD)", "todo", "demo-sara", 3, "ms-falcon-sds", ["t-falcon-usecases"], 7.8, None),
]
FALCON_MILESTONES = [
    ("ms-falcon-srs", "SRS submitted", "srs", datetime(2026, 10, 15, tzinfo=UTC)),
    ("ms-falcon-sds", "SDS submitted", "sds", datetime(2026, 11, 5, tzinfo=UTC)),
    ("ms-falcon-demo", "Final demo", None, datetime(2026, 12, 10, tzinfo=UTC)),
]
SECTION_OWNERS = {"1": "demo-student", "1.1": "demo-student", "1.2": "demo-sara", "1.3": "demo-student", "2.1": "demo-sara", "2.2": "demo-sara", "3.1": "demo-noura", "3.2": "demo-ali", "3.3": "demo-student"}
ACCEPTED_SECTIONS = {
    "1.1": "This document specifies the requirements for **Falcon Finder**, a web application that helps students report, search for and reclaim items lost on campus.",
    "1.2": "Falcon Finder covers reporting a found item, searching reported items, and claiming an item with proof of ownership. Payments, shipping and staff-only inventory tools are out of scope. Scope is informed by interviews with three students at the main library.",
}


def _ensure_student(db: Session, student_id: str, name: str, program: str, year: str, facts: dict[str, list[str]]) -> None:
    if db.get(Student, student_id) is None:
        db.add(Student(id=student_id, display_name=name))
        db.flush()
        db.add(StudentProfile(student_id=student_id, institution="Demo University", program=program, discipline="cs", year_label=year, onboarding_status="done"))
        for category, values in facts.items():
            for value in values:
                db.add(StudentFact(student_id=student_id, category=category, key=value[:120], value_json=json.dumps(value), source_kind="onboarding"))
    if db.get(User, student_id) is None:
        db.add(User(id=student_id, display_name=db.get(Student, student_id).display_name, role="student", student_id=student_id))


def _enroll(db: Session, course_id: str, user_id: str, role: str) -> None:
    if db.scalar(select(CourseEnrollment.id).where(CourseEnrollment.course_id == course_id, CourseEnrollment.user_id == user_id)) is None:
        db.add(CourseEnrollment(course_id=course_id, user_id=user_id, role=role))


def seed_teams(db: Session) -> None:
    if db.get(Team, DEMO_TEAM_ID) is not None:
        return
    base = datetime.now(UTC)

    def ago(days: float) -> datetime:
        return base - timedelta(days=days)

    for student_id, (name, program, year, facts) in STUDENTS.items():
        _ensure_student(db, student_id, name, program, year, facts)
    if db.get(User, INSTRUCTOR_ID) is None:
        db.add(User(id=INSTRUCTOR_ID, display_name="Dr. Layla Haddad", role="instructor"))
    for course_id, code, title in (("course-swe363", "SWE 363", "Software Engineering"), ("course-cs485", "CS 485", "Machine Learning")):
        if db.get(Course, course_id) is None:
            db.add(Course(id=course_id, code=code, title=title, term="Fall 2026", source="manual", external_id=f"demo-{course_id}"))
    db.flush()
    for course_id, students in (("course-swe363", SWE_STUDENTS), ("course-cs485", ML_STUDENTS)):
        _enroll(db, course_id, INSTRUCTOR_ID, "instructor")
        for student_id in students:
            _enroll(db, course_id, student_id, "student")
    for assignment_id, course_id, title, brief, deadline, deliverables, size in (
        ("asg-swe363-term", "course-swe363", "Term project: build and document a campus web app", SWE_BRIEF, datetime(2026, 12, 10, tzinfo=UTC), ["srs", "sds", "spmp"], (3, 4)),
        ("asg-cs485-project", "course-cs485", "Applied ML project", ML_BRIEF, datetime(2026, 12, 17, tzinfo=UTC), ["proposal", "report"], (2, 3)),
    ):
        if db.get(Assignment, assignment_id) is None:
            db.add(Assignment(
                id=assignment_id, course_id=course_id, title=title, brief_json=json.dumps(brief), deadline=deadline,
                deliverables_json=json.dumps(deliverables), rubric_json=json.dumps(brief["rubric"]),
                team_size_min=size[0], team_size_max=size[1], source="manual", external_id=f"demo-{assignment_id}",
            ))
    db.flush()

    team = Team(id=DEMO_TEAM_ID, assignment_id="asg-swe363-term", name="Group 1", cover_seed="f41c0n5eed01", lead_user_id="demo-student", charter_json=json.dumps(FALCON_CHARTER), created_at=ago(9.2))
    db.add(team)
    db.flush()
    members = {user_id: TeamMember(team_id=team.id, assignment_id=team.assignment_id, user_id=user_id, role_label=FALCON_CHARTER["roles"][user_id], joined_at=ago(9.2 - index * 0.05)) for index, user_id in enumerate(FALCON)}
    db.add_all(members.values())
    for milestone_id, title, deliverable, due in FALCON_MILESTONES:
        db.add(Milestone(id=milestone_id, team_id=team.id, title=title, deliverable_key=deliverable, due=due, created_at=ago(8.1)))
    db.flush()

    # Collect (when, type, actor, payload) and emit in time order so the replay scrubber is faithful.
    timeline: list[tuple[datetime, str, str | None, dict]] = []
    for index, user_id in enumerate(FALCON):
        timeline.append((ago(9.2 - index * 0.05), "member.joined", user_id, {"user_id": user_id, "display_name": STUDENTS[user_id][0]}))
    for milestone in db.scalars(select(Milestone).where(Milestone.team_id == team.id)).all():
        timeline.append((ago(8.1), "milestone.created", "demo-student", milestone_dict(milestone)))
    for position, (task_id, title, status, assignee, points, milestone_id, depends_on, created, moved) in enumerate(FALCON_TASKS):
        task = Task(id=task_id, team_id=team.id, title=title, status="todo", assignee_id=assignee, estimate_points=points,
                    milestone_id=milestone_id, depends_on_json=json.dumps(depends_on), position=position + 1, created_at=ago(created), updated_at=ago(created))
        db.add(task)
        db.flush()
        timeline.append((ago(created), "task.created", "demo-student", task_dict(task)))
        if moved is not None:
            task.status = status
            task.updated_at = ago(moved)
            timeline.append((ago(moved), "task.moved", assignee, {"id": task_id, "status": status, "position": task.position, "from": "todo"}))

    message_ids: list[str] = []
    for item in FALCON_CHAT:
        poll = item.get("poll")
        reply = item.get("reply")
        message = TeamMessage(
            team_id=team.id, author_user_id=item["by"], kind="poll" if poll else "text", content=item["text"],
            metadata_json=json.dumps({"options": poll}, ensure_ascii=False) if poll else None,
            reply_to_id=message_ids[reply] if reply is not None else None, created_at=ago(item["days"]),
        )
        db.add(message)
        db.flush()
        message_ids.append(message.id)
        votes = item.get("votes", {})
        db.add_all(PollVote(message_id=message.id, user_id=user_id, option=option) for user_id, option in votes.items())
        reactions = item.get("react", {})
        db.add_all(MessageReaction(message_id=message.id, user_id=user_id, emoji=emoji) for emoji, users in reactions.items() for user_id in users)
        timeline.append((ago(item["days"]), "message.created", item["by"], message_dict(message, reactions=reactions, votes=votes)))
    decision = Decision(team_id=team.id, text=FALCON_CHAT[DECISION_INDEX]["text"], source_message_id=message_ids[DECISION_INDEX], pinned_by="demo-ali", created_at=ago(8.45))
    db.add(decision)
    db.flush()
    timeline.append((ago(8.45), "decision.pinned", "demo-ali", decision_dict(decision)))

    title, outline = OUTLINES["srs"]
    document = TeamDocument(id="doc-falcon-srs", team_id=team.id, kind="srs", title=title, created_at=ago(7.5))
    db.add(document)
    db.flush()
    sections = []
    for position, (key, section_title) in enumerate(outline):
        content = ACCEPTED_SECTIONS.get(key, "")
        section = DocSection(id=f"sec-falcon-srs-{key}", document_id=document.id, key=key, title=section_title, position=position,
                             owner_user_id=SECTION_OWNERS.get(key), content_md=content, status="accepted" if content else "empty", version=1 if content else 0)
        sections.append(section)
    db.add_all(sections)
    db.flush()
    timeline.append((ago(7.5), "document.created", "demo-student", document_dict(document, sections)))
    for section in sections:
        if section.status == "accepted":
            timeline.append((ago(7.0), "section.updated", SECTION_OWNERS[section.key], section_dict(section)))

    timeline.sort(key=lambda item: item[0])
    last_seen_at = ago(FALCON_CHAT[LAST_SEEN_INDEX]["days"])
    last_seen_seq = 0
    for at, type_, actor, payload in timeline:
        event = emit(db, team.id, type_, actor, payload, created_at=at)
        if at <= last_seen_at:
            last_seen_seq = event.seq
    for member in members.values():
        member.last_seen_seq = last_seen_seq
    db.commit()


# Short demo roadmaps so teammate cards have a stage for growth-aware splits.
# (title, [(stage title, [(node title, status)])])
TEAMMATE_ROADMAPS: dict[str, tuple[str, list[tuple[str, list[tuple[str, str]]]]]] = {
    "demo-sara": ("ML engineer path", [("Foundations", [("Python for data", "done"), ("Linear algebra refresher", "done")]),
                                        ("Computer vision", [("CNN basics", "in-progress"), ("Data modelling for ML apps", "not-started")])]),
    "demo-ali": ("Backend engineer path", [("Web foundations", [("HTTP and REST", "done"), ("Node.js services", "done")]),
                                             ("Data and APIs", [("Relational schema design", "in-progress"), ("API authentication", "not-started")])]),
    "demo-noura": ("Product design path", [("Design basics", [("Figma fundamentals", "done")]),
                                             ("Interaction design", [("Usability testing", "in-progress"), ("Accessible UI patterns", "not-started")])]),
    "demo-omar": ("NLP research path", [("ML foundations", [("PyTorch basics", "done")]), ("Language models", [("Transformers", "in-progress")])]),
    "demo-reem": ("Data engineering path", [("SQL", [("Advanced SQL", "done")]), ("Pipelines", [("Batch pipelines", "in-progress")])]),
    "demo-faisal": ("QA automation path", [("Testing basics", [("Unit testing", "done")]), ("Automation", [("End-to-end tests", "in-progress")])]),
    "demo-lama": ("Mobile developer path", [("Kotlin", [("Kotlin basics", "done")]), ("Android", [("Jetpack Compose", "in-progress")])]),
}


def seed_teammate_roadmaps(db: Session) -> None:
    """Idempotent: only students with no roadmap at all get one."""
    from ..models import RoadmapVersion
    from ..schemas import RoadmapSnapshot

    for student_id, (title, stages) in TEAMMATE_ROADMAPS.items():
        if db.get(Student, student_id) is None:
            continue
        if db.scalar(select(RoadmapVersion.id).where(RoadmapVersion.student_id == student_id)) is not None:
            continue
        stage_rows, nodes = [], []
        for stage_index, (stage_title, items) in enumerate(stages):
            stage_id = f"{student_id}-s{stage_index}"
            node_ids = []
            for node_index, (node_title, status) in enumerate(items):
                node_id = f"{student_id}-n{stage_index}-{node_index}"
                node_ids.append(node_id)
                nodes.append({"id": node_id, "stageId": stage_id, "title": node_title, "status": status})
            stage_rows.append({"id": stage_id, "title": stage_title, "nodeIds": node_ids})
        snapshot = RoadmapSnapshot.model_validate({"title": title, "stages": stage_rows, "nodes": nodes})
        db.add(RoadmapVersion(student_id=student_id, version=1, snapshot_json=snapshot.model_dump_json(), reason="Demo roadmap", active=True))
    db.commit()
