---
'@plot-pm/board': patch
---

The queue no longer hands out a slice while an earlier slice of the same plan is only claimed and not merged. `planQueue` — a pure fold in `packages/domain/src/rules/queue.ts` — replaces the duplicated `claimed.has(branch) || merged.has(branch)` join in `queue-reading.ts` with one `settled` predicate that counts only a merged branch as settling the order, matching `plot-fleet-scan.sh`'s own rule; a claimed-but-unmerged first slice no longer makes a second slice claimable. A branch whose `<!-- waits: ... -->` annotation names an unmerged or unreachable prerequisite is now held under a new `waits` hold, reported on the tick's summary line and, under `--once`, as `<branch> — waits on <prerequisite> (unmerged|unreachable)`. The queue joins `packages/domain/corpus/eligible.corpus.test.ts` as a third surface compared against the fleet scan's own verdict.

<!--
plan: docs/plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md
-->
