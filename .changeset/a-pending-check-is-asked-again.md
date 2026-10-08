---
'@plot-pm/board': patch
---

fix(@plot-pm/board): a pending check is asked again before the next full read

A completed check run does not change a PR's `updatedAt`, so the delta refresh's `--since` window never saw it — a PR that finished CI stayed "CI running" on the board for as long as 24 hours, until the next full read (#1277).

The delta refresh now also asks the host, by number, for every stored OPEN PR whose `checks` is still `pending`. `pendingOpenPrNumbers` in `packages/domain/src/rules/pr-index.ts` is the pure rule naming which numbers qualify; `refreshPrs` in `packages/board/src/server/fleet.ts` folds the re-ask's answer through the same store as the primary delta. A PR whose check queue never runs is re-asked at most 5 consecutive times (`PR_PENDING_REASK_LIMIT`) before the bound gives up and leaves it to the next full read, so a stuck PR costs a small, finite number of extra requests rather than one more forever.

<!--
plan: docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md
-->
