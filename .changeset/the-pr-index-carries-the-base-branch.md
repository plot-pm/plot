---
'plot': patch
---

The PR index row carries the branch a pull request merges into as an optional `base` field, and `PR_INDEX_VERSION` moves from 6 to 7, so a v6 store reads as another version and the next PR beat writes a v7 store. The GitHub `pr-list` arms of `plot-host.sh` and the in-process GitHub read both answer `base`.

<!--
plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md
bumps:
  skills:
    plot: patch
-->
