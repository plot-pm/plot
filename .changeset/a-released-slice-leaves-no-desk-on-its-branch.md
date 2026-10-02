---
'plot': patch
---

`plot-dispatch.sh --release` now detaches a desk that still holds the released branch at `origin/<main>` and deletes the local branch, when the desk holds only empty claim commits, a clean tree and no live worker. Before, the kept desk had no upstream once the claim ref was deleted, the hand-over's checkout-yield rule read its claim commit as `unpushed-commits`, and every agent handed the slice wrote `PLOT-BLOCKED` and ended.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
