---
'plot': minor
---

`/plot-approve` writes the plan's `Tracker approved status` word to every issue the plan names, through `plot-issue-status.sh`, after the plan-state write. A failed write is reported on the new `tracker=` field of the summary line and the approval stands. `plot-issue-status.mjs` reads the three `Tracker * status` keys from config itself and no longer takes `--approved`, `--delivered` or `--released`.

<!--
plan: docs/plans/2026-10-29-tickets-follow-the-delivery-loop.md
bumps:
  skills:
    plot-approve: minor
    plot: minor
-->
