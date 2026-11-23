---
'plot': patch
---

`plot-reap` and reconcile section 21 no longer keep a merged desk for `.plot-worker.limited`, `.plot-worker.log.1` or `.plot-worker.continue.lock` in a repository whose `.gitignore` does not name them (#3144). The continue lock's own `.guard`, `.<pid>.tmp` and `.<pid>.stale` leftovers still keep the desk.

<!--
plan: docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md
bumps:
  skills:
    plot: patch
-->
