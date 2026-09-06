---
'@plot-pm/board': patch
---

A slice whose branches have merged no longer blocks the slices behind it. The queue counted outstanding branches from remote refs, and merging deletes the ref — so a finished slice read as unstarted forever. Measured 2026-09-06: eight briefed, eligible slices held `not-claimable` against five free agents; after the fix all eight dispatched and the tick's held count fell from 484 to 98.

<!--
plan: docs/plans/2026-09-06-a-merged-slice-has-no-ref-to-count.md
-->
