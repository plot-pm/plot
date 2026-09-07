---
'@plot-pm/board': minor
---

`plot-reap.sh` reports a worktree whose directory is gone. Git already knew — `git worktree list --porcelain` reports `prunable` for an entry deleted without git being told — and the reaper's five refusals could see none of them, because every one measures something *inside* a tree that is not there. Measured 2026-09-06: 3 of 20 worktrees on this estate were prunable and the reaper named none.

It is a REPORT, not a sixth refusal. The five say *do not remove this* and send an operator to go and look; this says *there is nothing to remove and the entry is stale*, and names `git worktree prune` as the repair. Nothing is pruned: whether to run it stays the operator's decision, the same discipline that keeps every refusal a measurement rather than an act.

The reading travels through the port it already had. `trees-git.ts` has parsed `prunable` since before any caller asked for it and no port carried it, so `Trees.presence(branch)` joins `ports/trees.ts` and answers `present`, `vanished` or `absent`. `TreePresence` gains `vanished`, and `finishedWith` reports it while making the four tree-sourced conditions `unknown` — a vanished directory supplies no reading for the same reason an absent one does not. The reaper gains no `git` call: the listing its loop already makes carries the field, and the awk now flushes per record because git emits `prunable` after `branch`.

<!--
plan: docs/plans/2026-09-06-a-desk-is-adopted-and-swept.md
bumps:
  skills:
    plot: patch
-->
