---
"plot": patch
---

The contract and board suites run in a temp root they own. `scripts/owned-run.sh` wraps both script strings, points `TMPDIR`, `HOME`, `PLOT_BUDGET_HOME` and `PLOT_PR_INDEX_HOME` inside one `plot-run.*` directory for the whole process tree, and removes it whatever the exit code. An entry left in that root fails the run and is named with its prefix. Measured 2026-09-30: one clean run of `test/reconcile/host.test.mjs`, 266 of 266 green, left 365 entries in an empty `TMPDIR` and wrote 430 lines into the operator's `~/.plot/state/budget.tsv`. The four measured leakers — `host` 365, `budget` 64, `state-gate` 21, `dispatch` 4 — now leave none.

<!--
plan: docs/plans/2026-09-30-every-temp-directory-has-an-owner.md
bumps:
  skills:
    plot: patch
-->
