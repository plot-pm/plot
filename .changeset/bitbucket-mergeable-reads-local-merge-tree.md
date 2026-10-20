---
'plot': patch
---

`plot-host.sh pr-state` and `pr-list --rich` on Bitbucket now read `mergeable` from a local `git merge-tree --write-tree <base> <head>` check instead of always printing `unknown`; a missing head or base ref, a failed fetch, or git older than 2.38 still reads `unknown`, now naming the reason in `mergeableReason`, and the host is never asked for it.

<!--
plan: docs/plans/2026-10-20-pr-state-and-pr-list-still.md
bumps:
  skills:
    plot: patch
-->
