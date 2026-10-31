---
'plot': minor
---

fleetd reverts the breaking merge when the default branch stays red past `Main repair bound`: it re-runs every run of the last green SHA and reads only the new attempt, claims `bug/revert-<pr>`, opens the revert PR and starts its review, then closes the fix PR and the revert PR when the episode ends and opens a ticket naming the reverted PR and its plan after a merged revert. A conflicting revert, a red revert PR, a HIGH on it and an `unknown` picker answer end the episode at `exhausted` with one notification. A failed host or CI read holds the pass and exhausts nothing. `plot-host.sh` gains `pr-close` and `rerun-all`.

<!--
plan: docs/plans/2026-10-29-a-red-default-branch-is-repaired.md
bumps:
  skills:
    plot: minor
-->
