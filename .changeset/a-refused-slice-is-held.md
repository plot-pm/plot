---
'plot': patch
'@plot-pm/board': patch
---

`QueueHold` gains `refused`: a slice an agent was handed and refused — writing `PLOT-BLOCKED.md` rather than working it — is held until a person clears the marker or the record naming it, instead of being handed to another free agent on the next pass.

Measured 2026-10-03: an agent handed `bug/the-queue-reads-the-scans-order` wrote `PLOT-BLOCKED.md` and stopped. `rules/queue.ts` had no hold for that, so the next pass read the slice as queued and handed it to another free agent, which hit the same refusal — 250 desks came from one slice this way, at 17 to 19 an hour. `blocked_on_held_checkout` in `plot-worker-loop.sh` now appends the branch to `.plot/state/refused-slices.tsv`, under the common git dir rather than the desk, so the record survives the desk's reap; the queue reads it by branch rather than by worktree, since a desk's manifest may already be cleared by the time the supervisor looks. `whyNotReady` tests `refused` after `slice-unnamed` and before the brief gate, bounded to a claimable slice for the same reason `slice-unnamed` is, so the hold never reaches the estate's unclaimable backlog. The tick line prints `refused=N` beside the other hold counts.

<!--
plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md
-->
