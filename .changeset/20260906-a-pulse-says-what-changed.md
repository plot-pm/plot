---
'@plot-pm/board': patch
---

`pulseDelta` answers what moved between two pulses — a PR merged, a worker died, a plan became deliverable — as a rule over readings with no I/O. Slice 2 of the plan whose first slice (#730) made the scan write its own record, so the history this compares against now accumulates in a repository with no board.

**It extends `rules/pulse.ts` rather than opening a file beside it.** `readingLoss` already answers three of this plan's design questions the same way: readings as values, a first run is not a failure, and name what changed rather than counting it. Two functions over two readings disagreeing about a first read is the drift this repo keeps measuring, so the delta consumes `readingLoss` rather than re-deriving it, and its six existing tests are unedited.

**The three are the story's, not the data's.** The bridge carries every slice verdict, every branch state, `ages`, `approvedAt` and `ideaPlans`; diffing all of it prints three lines nobody reads when three branches each advance one step. A fourth belongs here when somebody names the one they wanted and could not see.

**Four outcomes, and the pair that must never collapse.** `changed`, `unchanged`, `first` and `unusable`. A first run is a normal state — nobody has pulsed here yet, which is where every new adopter starts. A pulse that was found and could not be used is a different fact: `BRIDGE_MAX_AGE_MS` is fifteen minutes and `pulse-bridge.ts:193` returns null on a version mismatch. Reporting either as *nothing changed* tells a reader the estate is quiet when nothing was compared at all. The rule reads nothing, so the caller — which is what opened the file — passes which case it is.

**`elsewhere` is not a death.** It means no worktree on this machine, so the question could not be asked. A reading that stops being able to see a worker has not watched one die, and without that distinction every scan run from a second checkout would report deaths.

<!--
plan: docs/plans/2026-09-05-a-pulse-says-what-changed.md
-->
