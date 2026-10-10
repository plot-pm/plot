---
'plot': patch
---

The approve and deliver entries write the plan, hold and sprint files through the `PlanStore` port (temp file, then rename) and ask `Trees` for the main-checkout root and the desk-root exclusion, so `commonDirOf`, `mainRootOf` and `excludeDeskRoot` no longer parse `.git` by hand.

<!--
bumps:
  skills:
    plot-approve: patch
    plot-deliver: patch
    plot: patch
-->
