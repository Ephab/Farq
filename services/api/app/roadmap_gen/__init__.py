"""Staged roadmap generation: plan once, generate stage by stage.

Sequential by default. Individual stage endpoints are safe to call
concurrently (each stage job only appends its own stage under a lock),
which the parallel test proves — but the shipped flow runs stages in
order so every stage sees all earlier node IDs for wiring.
"""
