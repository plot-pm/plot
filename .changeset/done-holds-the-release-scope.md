---
'plot': patch
---

DONE lists every delivered plan that has not been released, whatever its age, so it names what the next release ships. The fleet scan admitted a delivered plan only for 24 hours after its `Delivered:` date; it now admits a plan at `Delivered` until it reads `Released`, and drops `Released`, `Rejected` and `Superseded` plans. Measured 2026-10-01: 25 plans awaited 2.22.0 and DONE showed 10.

<!--
plan: docs/plans/2026-10-01-done-holds-the-release-scope.md
bumps:
  skills:
    plot: patch
-->
