---
'plot': patch
---

`treesGit.addBranch` repeats `git worktree add` up to five times when the failure is a race with a concurrent `worktree add` in the same repository. Git 2.55 reads every `.git/worktrees/<name>/commondir` during an add and fails with `failed to read .git/worktrees/<name>/commondir: Result too large` when a sibling has created that file but not yet written it. In a local repro, 10 of 400 adds failed this way across 40 rounds of 10 concurrent adds; a repeat of the failed add succeeded every time. Any other failure still answers `failed` at once.

<!--
bumps:
  skills: {}
-->
