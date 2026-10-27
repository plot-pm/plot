---
'plot': patch
---

`/plot-reject` now calls `plot-undeliver.sh` for the State flip, the `Rejected:` record and the index move, stops on a `refs-swept` or `refs-unknown` refusal, and no longer declares an unowned write.

<!--
plan: docs/plans/2026-10-27-plot-undeliver-never-refuses-refs-swept.md
bumps:
  skills:
    plot-reject: patch
-->
