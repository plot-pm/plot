---
'@plot-pm/board': patch
---

A branch whose PR merged is no longer offered to a free agent. The queue read *claimed* off the remote ref, and merging deletes the ref, so the one event that finishes a slice returned it to the queue looking untouched. Measured 2026-09-05 on the first supervisor tick that ever matched agents to slices: of three hand-overs decided, two were branches merged an hour earlier, and only `--once` writing nothing kept the cost at zero.

Two questions, two readings. The ref still answers *has somebody started this*. *Is this finished* is new and is the host's `mergedAt`, consumed through `rules/landed.ts` rather than re-implemented — never a PR's `state`, never ancestry. `QueueHold` gains `already-merged` and `merge-unknown`; `isHandOverReady` is unchanged, having been told the wrong thing rather than being wrong.

An unaskable host holds the slice instead of offering it, which inverts the reaper's direction deliberately: there `not-merged` on silence keeps a checkout about to be deleted, and here the same word would hand finished work to an agent. The host is asked only of a slice that would otherwise be handed over — this estate carried 454 queued slices on the tick that found the defect.
