---
'plot': patch
---

The estate-wide shell suite is `pnpm run test:contracts`, not `test:reconcile`. The word `reconcile` named three things — the controller action, the `plot-reconcile-scan.sh` sweep, and this 75-file suite — and the suite had the weakest claim to it: 7 of its 75 files mention the sweep and the rest are contract tests for the helper estate plus seven CI gates. `CLAUDE.md`, `AGENTS.md` and `docs/definition-of-done.md` described all 75 as one file's plan-format tests and now name what the suite covers. The old name is gone rather than aliased, and the suite gained the `scripts/bounded.sh` wrapper it was the only root test script to lack. Its CI cancellations are also no longer unexplained: a full run finishes in 22m 08s carrying 139.3 minutes of test work, needing 11.6x parallelism to fit a 12-minute ceiling that was set when the suite had 42 files rather than 75.

<!--
plan: docs/plans/2026-09-09-reconcile-is-a-controller-action.md
bumps:
  skills:
    plot-reconcile: patch
-->
