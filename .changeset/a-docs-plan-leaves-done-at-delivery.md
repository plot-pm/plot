---
'plot': patch
---

A delivered docs or infra plan leaves DONE. `/plot-release` records `Released` only for feature and bug plans, so a docs or infra plan stops at `Delivered`; the fleet scan now drops it there instead of keeping it in DONE indefinitely.

<!--
bumps:
  skills:
    plot: patch
-->
