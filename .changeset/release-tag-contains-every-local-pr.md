---
'plot': patch
---

`/plot-release`'s tag resolution now asks the host about every local PR a plan names, not just the highest-numbered one, and refuses `tag-misses-pr` unless the resolved tag — chosen from whichever PR merged last by `mergedAt` — contains every one of them.

<!--
plan: docs/plans/2026-11-03-release-resolution-reads-a-cross-repo.md
bumps:
  skills:
    plot-deliver: patch
-->
