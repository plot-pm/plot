---
'plot': patch
---

The `bundle-commit`, `brief-name`, `state` and `phase` gates now recognize every form of a git commit — `git -C <dir> commit`, `git -c k=v commit --amend`, `git merge/rebase/cherry-pick/revert/am --continue` — not only the literal substring `git commit`, closing the gap PR #2965's repair committed through. Each gate resolves every committing call to its repository root and asks once per root; chained `add`/`mv` and the working-tree change read now scope to the `-C` directory of the call they judge rather than the process's own `cwd`.

<!--
plan: docs/plans/2026-10-31-the-commit-gates-match-only-the.md
bumps:
  skills:
    plot: patch
-->
