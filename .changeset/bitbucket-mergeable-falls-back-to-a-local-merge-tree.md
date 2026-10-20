---
'plot': patch
---

Bitbucket Cloud has no field or endpoint that reports a pull request's merge-conflict status (measured 2026-10-20 against ewz-kus-portal), so `pr.mergeable` reads `unknown` on every Bitbucket PR and the desk's merge-main-on-conflict path never started. The desk now asks a second way when the host answers `unknown`: a `git merge-tree --write-tree` run against the local checkout, read through a new `trees.mergeConflict` port method that touches neither the index nor the working tree.

<!--
plan: docs/plans/2026-10-20-pr-state-and-pr-list-never.md
bumps:
  skills:
    plot-dispatch: minor
-->
