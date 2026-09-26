---
'@plot-pm/board': minor
'plot': patch
---

`plot-impl-status.sh` asks `PrIndexStore` before the host. A new bundle, `board/plot-pr-index-lookup.mjs`, reads the store through `prIndexFile()` and answers per branch either the stored row or `ask`; the shell calls `plot-host.sh` only for what the store could not answer. A plan whose every slice merged — the case in which `/plot-deliver` runs — now makes zero host calls. This is the store's first shell consumer and the first outside the board process that writes it, so it answers what the shipped store had never been asked: a script reads it with no board running. Only MERGED rows are taken, because a merged PR cannot revert on the host; `OPEN`, `CLOSED` and draft rows are stale in either direction and fall through to `pr-state` as before. A missing store, a missing row, an unparseable or wrong-version one, a missing bundle, a node that will not run and a cross-repo annotation all mean *ask the host* — absence never becomes an answer. A branch resolved from the index carries no `mergeCommit`: the row holds none, and no reader of this helper's output reads it.

<!--
plan: docs/plans/2026-09-26-a-decision-reads-the-index.md
bumps:
  skills:
    plot: patch
-->
