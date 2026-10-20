---
'plot': patch
'@plot-pm/domain': patch
'@plot-pm/board': patch
---

`pr-list --rich` under `CI: jenkins` now carries `checksLookup: 'skipped'` on a row the pass did not look up, distinct from `checks: 'unknown'` for a row Jenkins genuinely could not answer, and `rowsToBind` rotates its cap across passes using the PR index's stored `checksSha` as memory so every open PR binds within a bounded number of passes instead of the same newest rows winning forever.

<!--
plan: docs/plans/2026-10-20-bitbucket-jenkins-a-pr-list-row.md
bumps:
  skills:
    plot: patch
-->
