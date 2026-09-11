# A failed gate becomes a correction

> A failing build reaches the agent that caused it as a correction prompt in its own session, bounded by an attempt budget, and blocks a person only when the budget is spent.

## Status

- **State:** Draft
- **Type:** feature
- **Story:** an-agent-is-declared-and-corrected
- **Review:** pr
- **Impl:** own branches

## Changelog

- A failing build is handed back to the agent that pushed it, in the same session, up to a bounded number of attempts. A `PLOT-BLOCKED` marker is written once the budget is spent rather than on the first failure.

<!-- Board impact: the agent row gains a correction count. AgentEntry and the
     board's schema both change; rebuild the artifact. -->

## Motivation

**The failure is already measured and reaches nobody.** `plot-build-monitor.sh:370` publishes `build failed` with the run URL, the head sha and the conclusion. Consumers of that finding on the estate, measured 2026-09-12: **none**. `buildMonitorPid` is read by the board's registry; the finding itself is read by nothing.

**The only correction path is a person.** `plot-worker-loop.sh:1683` writes a marker ending *"fix the invocation in the prompt file, then restart this agent."* That is right for a prompt that never ran — the case it was written for. It is the only shape Plot has, so a failing test produces a stopped agent rather than a second attempt.

**Three measured incidents are this gap.** Four workers hung in one session with nothing but bash and sleep. A stalled worker exited 0 leaving 324 uncommitted lines, indistinguishable from success. A worker sat at 0% CPU with its PR already open. In each case a correction existed and nothing delivered it.

**The pieces are all present.** The session id is on the manifest, the resume flag is the loop's decision, `attempts` is the supervisor's counter and the only one the budget reads, and the monitor knows the build failed. Nothing joins them.

## Design

### Approach

The BuildMonitor's `build failed` finding becomes a **correction file** in the desk. The loop reads it on its next pass, resumes the agent's session with the failure text verbatim, and increments an attempt counter.

**The failure text goes in verbatim.** A summarised failure is a second interpretation of something the CI system already stated precisely, and the run URL plus the conclusion are what a person would read. Paraphrasing here is the same error as a lookup table for context windows: usually right, and unexplainable when wrong.

**The agent never controls the retry.** The budget is the loop's, read from config, and an agent cannot extend it by declaring itself unfinished. That is the property that separates a correction loop from an agent that never stops.

### Corrections are asynchronous, and that is structural

A build's verdict arrives minutes after the push, so the correction cannot be a return value. The monitor publishes when it learns; the loop consumes when it next looks.

This is why the correction is a **file in the desk** rather than a message: the agent may be mid-slice, already hopped to another branch, or dead. A file survives all three, and the loop already reads the desk on every pass to decide whether it is resettable.

**A correction about a superseded sha is discarded, not delivered.** The monitor already distinguishes `head moved` — *"A green result for code nobody will merge is worse than no result"* — and the same holds inverted: a failure about a sha the agent has already replaced is answered by work that is already done.

### The budget's end is still a person

When the attempts are spent, the marker is written and the desk waits — today's behaviour, reached later. **The correction loop does not remove the human gate; it stops reaching for it first.**

The marker must say how many attempts were made and what failed each time, or the person inherits a stopped agent with no account of what was tried.

### Every marker names its writer

`PLOT-BLOCKED` carries no writer identity, and a marker written by one branch's worker into another's tree made a finished branch read as blocked. That was tolerable when markers were rare and written at the end. A correction loop writes more of them, so the ambiguity gets worse exactly as the volume rises.

Adding the branch and the agent to the marker is small and belongs here rather than in its own slice, because this slice is what increases the rate.

### Open Questions

- [ ] What is the default budget? Two attempts is a starting point and nothing here measures it. It must be configurable, and the first real number should come from watching the fleet rather than from this plan.
- [ ] Does a correction count against `Worker bound`? A corrected agent has been alive longer than its work suggests. Leaning yes — the bound is about the machine, not about progress.
- [ ] Should a repo-gate failure (`pnpm test`) use the same path as a CI failure? Same shape, different detector. Out of scope here; the CI path is the one with a monitor already watching.

## Slices

### A failed build becomes a correction (Branch: feature/a-failed-gate-becomes-a-correction)

The correction file in the desk, the loop's consumption of it, the attempt budget, and the superseded-sha discard.

### A marker names its writer (Branch: feature/a-marker-names-its-writer)

Branch and agent on every `PLOT-BLOCKED` marker. Independent of the slice above — a marker gains a field whether or not corrections exist — but it belongs to this plan because a correction loop is what raises the rate of markers.

## Notes

This is the slice that changes what the fleet *is*. Plot's gates stop things; after this, one class of gate corrects them. A fleet whose every failure ends at a person is parallel and supervised, not autonomous.
