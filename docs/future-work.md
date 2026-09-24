# Future work

The backbone deliberately ships only chat-driven memory and roadmap revision.

## Near term

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

Create read-only Blackboard and Outlook connectors behind a normalized university snapshot.
OAuth tokens must remain server-side. Imported announcements, syllabi, courses, deadlines,
grades, and slides require source metadata and refresh timestamps. Hermes receives normalized
records through tools rather than unrestricted account access.

## Current information

Enable web research only after adding source allowlists, citations, freshness metadata, and
prompt-injection defenses. Reddit and X require their own credentials and policies. Research
results should create suggestions awaiting review, never silently rewrite active roadmaps.

## Later product capabilities

- Scheduled trend refresh and stale-course-material detection.
- Updated lesson/slide generation with provenance.
- Co-op matching, portfolio-gap analysis, and company research.
- Group-project agents with bounded task assignment and student ownership.
- Notifications, calendars, and deadline-aware study plans.
- Production database, encrypted secrets, backups, observability, quotas, and deployment.

