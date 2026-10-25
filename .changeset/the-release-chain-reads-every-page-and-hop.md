---
'plot': patch
---

The release chain walk now pages through every GitHub PR on a branch instead of stopping at 100, seeds its first hop with the plan PR's own merge time instead of an empty one, carries a real `mergedAt` through every `pr-state` backend path, and gives `--no-fetch`/shallow-clone-aware advice when a merge commit can't be found (#2238, #2202).

<!--
plan: docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md
bumps:
  skills:
    plot-reconcile: patch
-->
