---
'plot': patch
---

A merged desk's stale `PLOT-BLOCKED.md` marker no longer pages a person forever, a desk's ending no longer answers for a branch it was not written for, a blocked worker's marker no longer claims it always self-reported, and `.plot/state/ending-asks.tsv` stays bounded.

`escalationWrites` (`registryd.ts`) now skips a desk `world.merged` reads as already merged before computing its notify rung, reusing the tick's existing `merges` memo rather than adding a second host call — fixing #1843's finding 1 (`mergedDeskState` already existed; nothing called it from this path). `readFreshAgentCandidates` now compares the ending file's own `branch` against the desk's checked-out branch before reading `ending`, `detail` or `refusedAssignment` from it, mirroring the guard `endingAsksFreshStart` already has for the operator-triggered continue path — fixing finding 2, where a worktree whose branch changed after a prior ending could still answer for the old one. `needsPersonMarker`'s `'blocked'` case no longer says "reported it could not proceed," since the same ending is also written when a turn's background work is dropped twice, not only on a self-report — fixing finding 4. `endingAskRecordFile`'s `append` now bounds the file at 500 rows, dropping the oldest when exceeded, and `freshAgentDeskReads` now memoizes `asked` for the lifetime of one tick rather than re-reading the file once per candidate — fixing finding 5, the slice's namesake issue, on both its growth and per-tick-re-read halves.

Of #1843's other five folded findings, none reproduce on current `main`: finding 3 (no reader of `status === 'blocked'`) is answered by `isBlocked()`'s existing caller at `supervision.ts:280`; the uncounted/unmemoized `prMerged` host call, the ending-ask record's `at`/`endingAt` field separation, the unrecorded ask, the unreadable-ending-time re-ask, and the ask-recorded-but-marker-write-order wording were all already fixed by work that landed after the issue was filed. The TSDoc the issue named as arguing design rather than interface reads as factual API documentation already. A desk marked only by a `blocked` declaration before #1391 still gets one marker and one notify on deploy, which remains the wanted behavior.

<!--
plan: docs/plans/2026-10-17-desk-markers-and-the-reaper.md
bumps:
  skills:
    plot: patch
-->
