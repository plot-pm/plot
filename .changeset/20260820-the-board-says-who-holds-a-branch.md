---
"@plot-pm/board": patch
---

board: WORKING and NOT STARTED read `held`, not the raw worktree path

#258 taught the board that a worktree holding a branch is somebody working, and
did it by reading the worktree PATH directly: `classify` lifted a branch out of
NOT STARTED whenever `local_worktree !== ''`. That path is present on one row it
should not lift — a clean worktree left on a branch whose work has already
landed. A squash-merged-and-deleted branch reads `open` here, because its ref is
gone and the merge is invisible to a plain ancestry walk, so the leftover
directory read as *somebody working* rather than as debris.

#266 added the fact that separates the two: `held` is the worktree path AND an
unmerged tip — the AND the scan already computes, emitted as one boolean so a
consumer reads it instead of re-deriving `!merged`. `FleetBranchSchema` has
carried it since, and until now nothing read it.

`classify` now reads `held`. The open-arm lift and the `held in a local
worktree` note both key on the boolean, so:

- an agent that committed and left a clean tree still reads WORKING — `held` is
  true where `local_dirty` and `local_ahead` (a could-not-compare 0 on a branch
  with no upstream) are both blind;
- a held branch is never offered as *eligible — nobody has taken it*, the
  invitation that sent a second agent at finished work on 2026-08-20;
- a clean leftover worktree on a merged-but-open branch stays in NOT STARTED,
  because the scan set `held: false` after excluding the merged tip — the
  merged-leftover misread the plan forbids.

The raw path no longer reaches `classify` at all: it names the worktree's
location, which the plan modal shows through the pulse's `worktrees` list, and
naming a place is a different job from deciding a lift. `held` obeys the same
one-directional rule as every other local signal — it may only lift a branch out
of quiet, never downgrade an answer, and it is false on every machine that holds
no worktree for the branch, so the claim ref stays the primary cross-machine
signal.
