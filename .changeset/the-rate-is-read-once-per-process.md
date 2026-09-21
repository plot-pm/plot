---
'plot': patch
---

`budget_rate` memoises its reading per (connector, account, bucket) for the life of the process, so the repeated questions inside one `plot-host.sh` call scan the ledger once instead of once each. Measured on `quatico/quaweb-website` at Plot 2.19.0, `budget.tsv` holds 312589 lines across 17.6 MB and one read of it takes 516 ms against 5 ms over fifty lines. The three call sites ask two distinct questions — an empty bucket for the concurrency bound, `graphql` for the transport choice — so the repeat collapses and the distinct question keeps its own scan: 3 scans become 2, and 1623 ms becomes 668 ms over a 60000-line record. The key is the whole triple, because an empty bucket means every bucket and is a different question from any named one. A caller that names an explicit moment bypasses the memo in both directions, since it is asking what the record looked like then. The cache lives under `$PLOT_BUDGET_HOME/memo/$$` rather than in a shell variable: every caller writes `rate="$(budget_rate ...)"` and a command substitution is a subshell, so a variable memo is written once per call and read never — measured at 3 scans for three substituted calls against 1 for three direct ones. `plot-host.sh` sweeps the directory on exit.

<!--
plan: docs/plans/2026-09-21-the-ledger-prunes-what-it-read.md
bumps:
  skills:
    plot: patch
-->
