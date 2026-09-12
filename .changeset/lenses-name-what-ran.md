---
'plot': minor
---

`/plot-deliver` step 5 gains lenses over its per-PR fan-out: it calls `/plot-panel` with one panel per plan, where each juror reads every merged PR through its own reading position rather than N agents asking one question of N diffs. Its verdicts now commit on two gated lines — `Position: supported|refuted` and `Evidence: executed|read` — because a command appended to the position line is never validated: measured against the shipped bundle, `Position: supported (ran pnpm test:contracts)` and a bare `Position: supported` commit identically. The gate checks the claim and not the command, which the skill and the README both say.

<!--
plan: docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md
bumps:
  skills:
    plot-deliver: minor
-->
