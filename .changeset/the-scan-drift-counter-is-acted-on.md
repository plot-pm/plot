---
'plot': patch
---

`plot-reconcile-scan.sh` splits `sprint_drift=` into the three findings it counted as one: `unplanned_members=` (a sprint member whose slug names no plan), `sprint_unset=` (a listed plan carrying no `Sprint:` field) and `sprint_mismatch=` (a plan whose `Sprint:` names a different sprint). The counter read 27 when the split was filed and 57 when that sprint closed with it unbuilt, and a reader who wanted to act had to re-derive the split from 57 lines. The first is reported and deliberately not called drift: a slice that merges as a PR with no plan file is normal here, so that component rises as work succeeds, and folding it in buried the two real defects. Each keeps the `inspect:`/`backfill:`/`fix:` line it already printed, all three stay below `== blocking sections end ==`, and `attention=` does not move.

<!--
plan: docs/plans/2026-09-11-the-scan-drift-counter-is-acted-on.md
bumps:
  skills:
    plot: patch
-->
