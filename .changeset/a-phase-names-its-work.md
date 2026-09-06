---
'plot': minor
---

Each phase of the development workflow declares the workflows that belong to it. `WorkflowName` was a flat union of eight names and the phases an ordered list of five, with nothing connecting them. `PHASE_WORKFLOWS` is a partition: the fleet's three — `assign`, `reap`, `supervise` — act on agents and desks rather than on a plan's lifecycle, so they belong to no phase and `phaseOf` answers `null` for them. No phase is invented for them, and nothing the board renders changes.

<!--
plan: docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md
bumps:
  skills:
    plot: minor
-->
