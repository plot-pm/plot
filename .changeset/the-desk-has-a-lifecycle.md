---
'plot': patch
'@plot-pm/board': patch
---

`rules/desk-lifecycle.ts` names every state a desk can be in — `working`, `finished`, `orphaned`, `refused-empty`, `refused-with-work`, `holding-work`, `unplaced` — and the exit each one has, so the next way a desk gets stuck is found by reading the type rather than by counting desks. `reapProblems` asks it: a `PLOT-BLOCKED*` marker refuses reaping only when the desk holds anything beside it, so a marker on an otherwise-empty, already-landed desk is reapable, and the reaper copies the marker's text to `.plot/state/refusals.tsv` before removing it. Reconcile's desk section reports the state and the exit per desk instead of combining the reaper's kept-reasons itself.

Measured 2026-10-03: `.worktrees/` held 269 desks, 250 from one slice at 17 to 19 an hour, cleared only by removing an orphaned desk by hand, trashing 250 markers, and running the reaper. Two earlier fixes each closed one entry to this state — `plot-dispatch.sh --release` detaching a released desk, and the loop reading a missing `@{upstream}` as unlanded work — and this slice gives the domain the list those fixes had no place to join.

<!--
plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md
-->
