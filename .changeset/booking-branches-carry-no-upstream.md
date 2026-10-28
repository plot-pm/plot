---
'plot': patch
---

`treesGit.addBranch` and `resetBranch` now pass `--no-track` when cutting a booking branch from `origin/<default>`, so git writes no `branch.<name>.merge`/`.remote` keys into the shared `.git/config` — the write that collided under concurrent booking worktrees with `error: could not lock config file .git/config: File exists`. A booking branch is pushed as `<branch>:<default>` and never reads an upstream, so nothing needed those keys.

<!--
plan: docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md
bumps:
  skills: {}
-->
