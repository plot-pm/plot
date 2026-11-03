---
'plot': patch
---

`release-approve` now tells each booked plan's tracker as part of booking it Released, closing the gap where its sprint-booking pass left every linked issue open with no `plan:released` label; `/plot-release` step 5b's `plot-deliver.mjs --release` repairs any plan that pass misses.

<!--
plan: docs/plans/2026-11-03-a-release-through-release-approve-leaves.md
bumps:
  skills:
    plot-release: minor
-->
