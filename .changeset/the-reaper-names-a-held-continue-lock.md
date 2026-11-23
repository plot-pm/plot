---
'@plot-pm/board': patch
---

`plot-reap` keeps a desk whose continue lock is held and prints `continue lock held by pid <pid>, expires in <n> s`, or `continue lock unread` where the lock file cannot be read. A dirty desk the worktree report already named prints no second row: owned dirty trees print under `-- dirty trees with an owner --`, and `-- dirty trees nobody owns --` lists `LEFTOVER` rows only (#3144).

<!--
plan: docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md
bumps:
  skills:
    plot: patch
-->
