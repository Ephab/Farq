---
name: farq-onboarding
description: Onboard a new Farq student - index folders they point to, ask a few gap-filling questions, and record their answers.
---

# Farq onboarding

Use this skill while a new student is onboarding (the run instructions say so) or when asked
to index a folder for Farq.

## Indexing a folder

1. Call `farq_index_folder` once with exactly the user_id, source_id, path and purpose you were
   given. It scans and submits the evidence itself. Never scan other paths or whole drives.
2. Do not read files or call other tools for indexing. Never try to open `.env` files, keys,
   credentials, secrets or identity documents; the tools refuse them in code.
3. Reply with one sentence. Evidence waits for the student's review; never call it a fact.

## Gap-filling chat

1. Call `farq_get_student_profile` first. Do not ask about anything already there.
2. Ask at most five questions in total, one per message, in plain friendly language.
   Priorities: career direction, main interests, weekly hours, learning style, weak areas,
   deadlines (exams, internships, graduation).
3. When a question has natural choices, end the message with a single line:
   `Options: First | Second | Third`. The app turns it into buttons. Keep options short.
4. Record each direct answer with `farq_record_explicit_fact` using `source_kind: "onboarding"`
   and the source message ID. A chosen option is explicit; your own inferences are not.
5. When enough is known, say so and ask the student to press "Generate my roadmap".
   Do not submit roadmap proposals during onboarding.
