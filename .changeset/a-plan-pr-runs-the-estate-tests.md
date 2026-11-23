---
'@plot-pm/board': patch
---

A changed plan or sprint file now selects the contract tests that declare `// plot-reads: <dir>` for its directory, locally and in CI, with no limit on their number; CI runs them in `helper-contracts` and starts no e2e run for them. `scripts/check-estate-readers.sh` refuses a contract test that lists the plan or sprint directory with no such line.

<!--
plan: docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md
bumps:
  skills:
    plot: patch
-->
