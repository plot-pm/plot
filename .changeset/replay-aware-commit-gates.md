---
'plot': patch
---

The state gate now clears a rebase or cherry-pick stopped on a conflict when the picked commit's own before/after against its own first parent matches the transition exactly, so replaying an already-receipted lifecycle change needs no second receipt. The phase gate now drops a staged path from a conflicted `git merge origin/<main>` when its blob is unchanged from the blob already at a `MERGE_HEAD` commit confirmed contained in `origin/<main>`, so finishing that merge no longer reads main's own untouched paths as the branch's own.

<!--
plan: docs/plans/2026-10-31-the-commit-gates-match-only-the.md
bumps:
  skills:
    plot: patch
-->
