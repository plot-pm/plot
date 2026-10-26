---
'plot': patch
---

Jenkins sha-lookup tests in `test/reconcile/host.test.mjs` now run in a private `HOME` and `PLOT_BUDGET_HOME`, so running the file directly (as `plot-local-checks.mjs` tells an agent to for a changed file) no longer writes Jenkins budget-ledger lines into the operator's real `~/.plot/state/budget.tsv`. The two `run-for-sha`/`runs-for-sha` combined tests are split into four titled tests naming what each proves, and a new test covers `runs-for-sha` against a plain (non-multibranch) job, which no prior test exercised.

<!--
plan: docs/plans/2026-10-24-jenkins-sha-lookups-in-plot-host.md
bumps:
  skills: {}
-->
