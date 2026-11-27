---
'plot': patch
---

fleetd ends a review run that passed its 3600 s bound and starts a new review on the head. A hung `plot-review.mjs` whose pid still answered, or a review lock whose holder hung, held `review-in-flight` with no age limit, so a stale `pending` `plot/review` was never asked again (#3658 waited 9 h 11 min). A run past the bound plus the 30 s start grace now reads dead, the lock holder carries the lock's time, and the pass logs each run it ends to `slice-review.log`.

<!--
plan: docs/plans/2026-11-27-a-stale-pending-review-is-asked-again.md
bumps:
  skills:
    plot: patch
-->
