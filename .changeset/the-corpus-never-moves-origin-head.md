---
'plot': patch
---

The corpus test for the refs adapter pins a disposable clone instead of writing a ref into the shared repository, so a run killed mid-`beforeAll` leaves `origin/HEAD` untouched. `plot-default-branch.sh` also now refuses a symref naming `plot-corpus-pin` by name, whether or not it resolves, so a leftover from an interrupted run outside this test is still repaired.

<!--
plan: docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md
bumps:
  skills:
    plot: patch
-->
