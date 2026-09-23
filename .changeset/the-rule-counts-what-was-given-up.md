---
'@plot-pm/board': patch
---

A plan whose every slice was deferred is deliverable again. `allSlicesMerged` counted only non-deferred branches, so such a plan reached its final guard with `merged === 0` and answered `not-merged` — the same word a plan nobody built gets. Measured 2026-09-22: the deliver controller refused a plan that `plot-deliver.sh` would have delivered, and the two had disagreed through four released deliveries of that shape. The unattended `auto-deliver` path now measures the landed-branch requirement it had been inheriting, so it keeps refusing a shelved plan while a person may deliver one.

<!--
plan: docs/plans/2026-09-22-work-given-up-is-not-work-never-done.md
-->
