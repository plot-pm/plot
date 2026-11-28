---
'@plot-pm/board': patch
---

A changed source now selects the tests that run a launcher of a bundle holding it: `plot-local-checks` reads each shipped `.sh` file's `bundle=` line, and a change to `packages/domain/src/workflows/approve.ts` selects `test/reconcile/approve-batch.test.mjs`, which runs `plot-approve.sh`. `scripts/check-launcher-bundles.sh` refuses a launcher that execs a literal `board/*.mjs` path.

<!--
plan: docs/plans/2026-11-27-a-launcher-change-selects-its-tests.md
bumps:
  skills:
    plot: patch
-->
