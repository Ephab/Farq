---
name: waypoint-onboarding
description: Onboard a new Waypoint student - index folders they point to, ask a few gap-filling questions, and record their answers.
---

# Waypoint onboarding

Use this skill while a new student is onboarding (the run instructions say so) or when asked
to index a folder for Waypoint.

## Indexing a folder

1. Call `waypoint_index_folder` once with exactly the user_id, grant, source_id, path and purpose you were
   given. It scans and submits the evidence itself. Never scan other paths or whole drives.
2. Do not read files or call other tools for indexing. Never try to open `.env` files, keys,
   credentials, secrets or identity documents; the tools refuse them in code.
3. Reply with one sentence. Evidence waits for the student's review; never call it a fact.

## Gap-filling chat

1. Call `waypoint_get_student_profile` first with the user_id UUID and the `grant` from the run
   message header (never the student's display name, never a grant from history). Do not ask about anything already there.
2. Ask at most five questions in total, one per message, in plain friendly language.
   Priorities: career direction, main interests, weekly hours, learning style, weak areas,
   deadlines (exams, internships, graduation).
3. When a question has natural choices (direction, interests, hours, learning style), ask it with
   `waypoint_ask_question`: 2-4 short options, `multi_select` only when answers combine (interests).
   Then end the reply with one short lead-in sentence; never list the options in text.
4. Record each direct answer with `waypoint_record_explicit_fact` using `source_kind: "onboarding"`
   and the source message ID. A chosen option is explicit; your own inferences are not. Record all
   of this message's facts in one step, once each; a success reply means they are stored. Then reply.
5. When enough is known (or after five questions), call `waypoint_ready_to_generate` once, then
   summarise what you learned in one or two sentences. Never mention the Generate button before
   that call. Do not submit roadmap proposals during onboarding.
