"""Onboarding pipeline: modular background-collection steps.

Each step has one input/output. The legacy `app.onboarding` module
re-exports the canonical implementations so existing imports keep working.

Steps:
1. profile_step  - basics (institution/program/discipline/year/graduation)
2. evidence_step - per-source ingest into suggested EvidenceItems
3. review_step   - student confirm/dismiss -> StudentFacts
4. chat_step     - gap-fill chat constants live in app.hermes
5. brief_step    - deterministic profile brief + readiness gate
"""
