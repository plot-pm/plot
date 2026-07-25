---
"plot": minor
---

Plan: harden Plot against documented Claude Opus 5 long-horizon failure modes. Bounds the `ralph-plot-sprint` loop (wall-clock budget, per-iteration deliverable checkpoint, ship-partial fallback, heartbeat), bounds `challenge-the-plan` (question budget, material-vs-marginal filter, falsifiable stopping rule), tightens `plot-deliver` gates so subagent claims must cite file-path evidence, states `plot-reconcile` read-only-ness as a design invariant, promotes tracer bullets to the default recommendation in `plot-approve`, adds Manifesto Principle 10 ("an agent that has gone quiet has failed, not finished"), and records model provenance for the skills. Adds three optional `## Plot Config` keys with documented defaults: `Sprint wall clock`, `Sprint stall limit`, `Challenge question budget`.

<!--
bumps:
  skills:
    plot: minor
-->
