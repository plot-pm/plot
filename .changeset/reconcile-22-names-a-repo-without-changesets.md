---
'plot': patch
---

`/plot-reconcile` section 22 no longer reports that every merge carried a changeset in a repository that keeps none: it says it was not evaluated. A new `Shipped code paths` key (an extended regex, read with the new `plot-config.sh get-raw`) names which paths count as shipped code, an invalid pattern is reported as not evaluated, and Bitbucket merge subjects name their branch.

<!--
plan: docs/plans/2026-10-22-reconcile-22-reports-every-merge-carried.md
bumps:
  skills:
    plot: patch
    plot-reconcile: patch
-->
