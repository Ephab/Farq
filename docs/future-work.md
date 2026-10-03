# Future work

The backbone deliberately ships only chat-driven memory and roadmap revision.

## Near term

- **Next: screenshot-based VLM evaluation.** Feed captured desktop/mobile screenshots to a server-selected vision model and combine screenshot-cited visual findings with DOM/log/test evidence. The current evaluator captures PNGs but never sends their pixels to its reviewer. Validate visual defect detection and document image disclosure/prompt-injection boundaries before enabling it.

- Threat model for Group Projects team chat → Hermes: teammate-written prompt injection,
  proposal flooding (rate-limit proposals per run), and what a malicious section draft can contain.
- Group Projects sub-projects 4-6: teammate finder (opt-in matching), peer evaluation and viva
  prep, requirement → design → task → test traceability graph.
- Threat model for the onboarding folder scan: path allowlisting, symlink escapes, what a
  malicious README can make Hermes submit, and whether indexing should move to a sandbox.
- OCR for scanned transcripts and exam PDFs; Arabic-aware transcript parsing.
- DNS-rebinding hardening for the portfolio fetch (pin the resolved address per request).
- "Coming soon" sources per discipline (`services/api/app/disciplines.py`): Kaggle, LeetCode,
  GrabCAD, clinical logbooks, Anki stats, question-bank exports, SSRN, Credly, Behance.
- Automatic re-sync of existing sources (GitHub, folders) on a schedule. Adding sources later
  already works from the "My data" page, which hands off to Hermes Coach for a proposal.
- Show richer visual diffs for moved dependencies and added branches.
- Let students inspect, correct, and delete stored facts.
- Add an agent tool for quiz generation while keeping scoring deterministic in FastAPI.
- Connect lesson generation and quiz performance to roadmap proposals.
- Add authentication (onboarding currently creates a student and the browser remembers its id)
  and enforce user identity at the tool boundary.

## University data

The hackathon build now has a read-only, pre-indexed Blackboard demo snapshot populated from an
explicit allowlist of local lecture folders plus synthetic demo announcements, syllabi and
assignments. Hermes can list courses, list content, search, read bounded chunks and inspect updates.
It cannot log in to Blackboard or browse arbitrary LMS pages.

Replace the demo importer with an institution-approved Blackboard Learn REST integration using
Three-Legged OAuth (3LO). OAuth tokens must remain server-side, scopes must be read-only and
least-privilege, and refresh should use incremental timestamps plus idempotent upserts. Add an
Outlook connector behind the same normalized university snapshot. Imported announcements,
syllabi, courses, deadlines, grades and slides must preserve provenance and refresh timestamps;
Hermes should continue receiving only normalized records through bounded tools.

## Current information

Enable web research only after adding source allowlists, citations, freshness metadata, and
prompt-injection defenses. Reddit and X require their own credentials and policies. Research
results should create suggestions awaiting review, never silently rewrite active roadmaps.

Hackathonat is now the primary cached Saudi-hackathon connector. Before production scale, request
an official integration agreement, monitor its undocumented JSON schema, and move the six-hour
in-process refresh loop to a distributed scheduler. Outlook should implement the same opportunity
connector contract and merge duplicate registration URLs while preserving both sources.

## Later product capabilities

- Scheduled trend refresh and stale-course-material detection.
- Updated lesson/slide generation with provenance.
- Extend co-op discovery with generic web search, authenticated Jadarat/Outlook ingestion,
  official integration agreements, deadline notifications, portfolio-gap evidence and an
  application/interview tracker.
- Group-project agents with bounded task assignment and student ownership.
- Add Playwright interaction/screenshot capture and richer headless CAD/KiCad adapters to the project
  evaluator. The native QA agent now executes authorized local CLI/test, HTTP and Playwright checks and produces an evidence-cited rubric review. Remote submissions still need a real sandbox. Visual model review of screenshot pixels, broader launch adapters, CAD/circuit behavior and physical claims remain unverified.
- Notifications, calendars, and deadline-aware study plans.
- Production database, encrypted secrets, backups, observability, quotas, and deployment.

