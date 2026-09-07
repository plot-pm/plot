---
'@plot-pm/board': minor
---

`finishedWith(readings)` states every condition that holds a desk, in one place. `plot-reap.sh` removes a checkout and `plot-release-refs.sh` deletes a remote ref, and between them they apply eight conditions — a given-up branch, no merged PR, an open PR, a checkout, the default branch, a live worker, uncommitted work, a `PLOT-BLOCKED` marker. Until now which script asked which was visible only by reading both.

Each condition answers `true`, `false` or `unknown`. `unknown` is a reading and not an error: measured 2026-09-06, 22 of 32 remote branches have no worktree — 69% — and four of the eight conditions need that tree. A boolean would invent an answer on two branches in three, for the operation no `git worktree add` can undo, and refusing on silence — the estate's rule for an unreachable host — would block deletion on the same 69% and make the ref-deleter useless exactly where it is needed. So the reaper reads an unread tree as nothing to reap and the ref-deleter reads it as no evidence against deletion, and the caller decides rather than the rule.

The rule permits nothing, enumerates nothing and reads no plan, so both scripts and both existing verdicts are unchanged. Two assertions pin the differences: an open PR is stated and leaves `reapProblems` empty, and a live worker pid is stated while `reapProblems` refuses on it.

<!--
plan: docs/plans/2026-09-05-a-desk-is-finished-with-once.md
bumps:
  skills:
    plot: patch
-->
