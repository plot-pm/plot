---
'@plot-pm/board': patch
---

A change to a bundle's entry source now selects the tests that name the shipped bundle, locally and in CI. The build writes each bundle's entry source to `BOARD_BUNDLE_ENTRIES`, and the test selection adds the bundle's basename to that source's search terms.

<!--
plan: docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md
bumps:
  skills:
    plot: patch
-->
