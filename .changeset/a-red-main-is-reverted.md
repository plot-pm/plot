---
'plot': minor
---

fleetd reverts the breaking merge when the default branch stays red past `Main repair bound`: it re-runs every run of the last green SHA and reads only the new attempt, claims `bug/revert-<pr>`, opens the revert PR and starts its review, then closes the fix PR and the revert PR when the episode ends and after a merged revert opens a ticket and notifies, naming the reverted PR, its branch and the plan file whose slices name that branch. A conflicting revert, a red revert PR, a HIGH on it and an `unknown` picker answer end the episode at `exhausted` with one notification. A failed host or CI read holds the pass and exhausts nothing. A last green re-run that is not accepted or not settled within `Checks wait` after the bound ends the episode at `exhausted`, and a lost revert claim ends that machine's revert for the episode. `plot-host.sh` gains `pr-close` and `rerun-all`, which exits 1 where no run matches the SHA.

<!--
plan: docs/plans/2026-10-29-a-red-default-branch-is-repaired.md
bumps:
  skills:
    plot: minor
-->
