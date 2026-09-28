---
'plot': patch
---

A backticked branch name in a slice heading, `(Branch: `bug/x`)`, is now read. A slice heading that carries `Branch:` and yields no branch is listed in the parser's new `unread_branch_headings` field and reported by `/plot-reconcile` section 24 (`unread_headings=`), which names the repair and gates nothing.

<!--
plan: docs/plans/2026-09-28-a-heading-names-a-branch-or-says-it-could-not.md
bumps:
  skills:
    plot: patch
    plot-reconcile: patch
-->
