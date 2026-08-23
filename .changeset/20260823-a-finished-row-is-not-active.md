---
"@plot-pm/board": patch
---

board: a finished row reports neither a pulse nor a live worker

DONE wore a green activity mark it did not earn, and some of its rows presented a
worker state that had already gone stale. Both were one category error in one
file: a LOCAL fact — a worktree's contents, a worklog's last recorded worker —
answering a question about work that is FINISHED. Measured on the live board
2026-08-23, seven DONE rows reported activity and every one was dirty on the same
file: `test/fixtures/tiny-garden/.plot/state/last-pulse.json`, the fixture the
board suite rewrites when it runs. The board was reporting activity caused by
running its own tests.

The domain model states the boundary — *a local fact may DESCRIBE a row and may
never ORDER the fleet* — and these two reads crossed it.

Decided and enforced:

- **The guard is finishedness, never a filename.** A new `isFinished(row)` is
  `state === 'merged' || state === 'deferred'` — the branch's own ref state,
  which every reader can verify. Ignoring `last-pulse.json` specifically would
  silence today's instance and leave the rule wrong: any uncommitted file in any
  stale worktree brings the mark back looking like a new bug.
- **`isActive` now screens both finished states, not only `merged`.** One of the
  seven marked rows was `deferred` with a dirty worktree; the merged-only guard
  let it through. A finished row reports no pulse regardless of what its worktree
  holds.
- **A finished wave-of-one no longer shows a live worker.** The worker outlives
  its branch, so its last state can survive the merge — `waiting` is a LIVE
  worker and reached the wave row's status slot, reading as *someone owes this an
  answer* under a heading that says done. A new `soleRowStatus` skips the live
  worker on a finished row and falls back to the PR then the branch state.
- **The mark keeps working where it was right.** A WORKING row with `localDirty`,
  and an unfinished wave with a live worker, are unchanged — the regression that
  matters is asserted directly.

Client-side only: no schema or server change. A stale worktree on a merged branch
is still a real condition worth a STATIC mark of its own; that mark is a later
wave and this never gives it the motion one.

<!--
bumps:
  skills:
    plot: patch
-->
