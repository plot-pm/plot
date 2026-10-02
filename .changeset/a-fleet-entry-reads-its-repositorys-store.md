---
'@plot-pm/board': patch
---

A fleet entry now reads and writes the PR store of its own repository rather than one shared module-level store built with no `cwd`. `prStoreFor(repoRoot)` resolves and caches one `PrIndexStore` per repository per process, so a board process serving several repositories keeps each one's PRs in its own file instead of folding them all into whichever repository the process started in. `PLOT_PR_INDEX_HOME` keeps priority over `repoRoot`, unchanged.
