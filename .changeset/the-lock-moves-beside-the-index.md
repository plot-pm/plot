---
'plot': minor
---

Ports forward the PR reader's election and lock code from the deferred `feature/one-pr-reader-per-machine-and` branch, redesigned per panel review: `packages/domain/src/rules/reader-election.ts` (`readerIsStale`, `electReader`, `heartbeatIsFresh`), `packages/domain/src/ports/reader-lock.ts`, and a file adapter plus fixture at `packages/domain/src/adapters/reader-lock/`. The lock key drops the account segment, generation-numbered `owner.<n>` files published by `link()` close the takeover race the prior design left open, and the lock lives beside the PR index file under the same `realpath`d common git directory rather than under `PLOT_BUDGET_HOME`. This branch adds no caller.

<!--
plan: docs/plans/2026-10-23-one-pr-reader-per-machine-and.md
bumps:
  skills:
    plot: minor
-->
