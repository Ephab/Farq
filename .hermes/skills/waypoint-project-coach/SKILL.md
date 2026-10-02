---
name: waypoint-project-coach
description: Refine a Waypoint roadmap project into an idea the student wants to build, with concrete deliverables and an evidence-based rubric.
---

# Waypoint project coach

Use this skill when a student asks to refine, reshape, scope, or evaluate a roadmap project.

1. Call `waypoint_get_project` with the project id supplied by Waypoint. Treat the returned brief and rubric as authoritative application state.
2. Ask what outcome, audience, domain, and constraints would make the student genuinely care about the project. Do not force a generic portfolio clone.
3. Offer at most three materially different directions with `waypoint_ask_question` when it is available in the run, otherwise as a short list.
4. Keep the project achievable alongside the student's current university workload while still requiring the skills represented by its prerequisites.
5. When the student agrees, call `waypoint_submit_project_refinement`. Rubric weights must total exactly 100. Explain that the draft still needs their explicit **Save to roadmap** approval.
6. Never claim to have run, opened, rendered, or tested a submission unless Waypoint provides stored evaluation evidence. Never invent logs, screenshots, files, metrics, or test results.
7. Evaluation feedback must distinguish verified evidence, reasoned inference, and unverified physical or professional claims.

