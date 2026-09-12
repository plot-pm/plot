# A failed gate becomes a correction

> A failing build reaches the agent that caused it as a correction prompt in its own session, bounded by an attempt budget, and blocks a person only when the budget is spent.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** an-agent-is-declared-and-corrected
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-12, jwloka, in-session
- **Rounds:** 2
- **Started:** 2026-09-12, Jan Wloka, `feature/an-absent-agent-is-noticed`

## Changelog

- The fleet reports an agent whose process has gone, instead of reporting it `running`. The reading is the agent's own `claude` process, never the wrapper's CPU, which is near zero whether the agent is alive or dead.
- A failing build is handed back to the agent that pushed it, in the same session, up to a bounded number of attempts. A `PLOT-BLOCKED` marker is written once the budget is spent rather than on the first failure.
- Every `PLOT-BLOCKED` marker names the branch and agent that wrote it.

<!-- Board impact: the agent row gains a correction count and an absent-process
     reading. AgentEntry and the board's schema both change; rebuild the artifact. -->

## Motivation

**A worker that stops is invisible until a person reads `ps`.** Measured 2026-09-11, in one session: **four agents** ended mid-slice. None failed a build, none wrote a `PLOT-BLOCKED` marker, and every one reported `running` in `plot-fleetctl.sh --status` with a plausible quiet time. Three of them left **8 commits and 9 uncommitted files** on their desks, each with an unstaged `.changeset/` file — the last thing written before pushing. Every one was one step from done, and all three would have been reaped as abandoned.

**The wrapper's CPU cannot tell a live agent from a dead one.** Both read `0.02s over ~50 minutes`, because the work happens in a grandchild. The only reliable test is whether a `claude` process exists two levels down — which nothing in Plot performs.

**So the fleet's most expensive failure today was not a failing gate. It was an absent process.** That is what this plan must answer first.

**A failing build is the second half, and it is measured too.** `plot-build-monitor.sh:370` detects a failing run and publishes `build failed` with the run URL, the head sha and the conclusion. Consumers of that finding on the estate: **none**. `buildMonitorPid` is read by the board's registry; the finding itself is read by nothing. So CI's verdict is measured, published, and dropped.

**The only correction path is a person.** `plot-worker-loop.sh:1683` writes a marker ending *"fix the invocation in the prompt file, then restart this agent."* That is right for a prompt that never ran — the case it was written for — and it is the only shape Plot has.

**The pieces are all present.** The session id is on the manifest, the resume flag is the loop's decision, `attempts` is the supervisor's counter and the only one the budget reads, and `plot-worker-state.sh` already names `stalled` — unlanded work with no live process. Nothing joins them.

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

- [x] What is the default budget? **Two, configurable, and the config comment says it is a guess.** Nothing has measured it; the first real number comes from watching the fleet. Recording the guess as a guess is what stops it hardening into a decision nobody made.
- [ ] Does a correction count against `Worker bound`? A corrected agent has been alive longer than its work suggests. Leaning yes — the bound is about the machine, not about progress.
- [ ] Should a repo-gate failure (`pnpm test`) use the same path as a CI failure? Same shape, different detector. Out of scope here; the CI path is the one with a monitor already watching.

## Slices

### An absent agent is noticed (Branch: feature/an-absent-agent-is-noticed, PR: #900)

The fleet reports an agent whose process is gone, rather than reporting it `running`.

**The reading is the `claude` process two levels down**, never the wrapper's CPU: measured 2026-09-11, a healthy agent's wrapper shows `0.02s over 25 minutes` because the work happens in a grandchild, and a dead one shows the same. A live agent has a `claude` child with CPU accruing; a dead one has only `sleep 28800` and `sleep 5`.

`plot-worker-state.sh` already owns this question and already names `stalled` — unlanded work with no live process. This slice makes the reading reach it, so `--status` stops printing `running` for a desk nobody is at.

**It reaps nothing, and it hands the slice on.** Four desks measured today held work one step from done, so a sweep that deleted on this reading would have destroyed it. Instead the desk is **inherited untouched** and a new agent continues from it — the shape `--restart` already has, where *"a stall IS uncommitted work"* and one measured here left 324 finished lines on the floor.

**The hand-over reuses `--restart`'s guards rather than writing a second, laxer set.** That is the argument `plot-dispatch --stop` makes against a second stop rule, and it matters more here because this path runs with nobody watching. **The PR is asked FIRST, before the state word** — five of five `failed` worktrees measured on this estate held one, four open and one merged — then a live pid, then a `PLOT-BLOCKED` marker. Any of the three refuses the hand-over and the desk waits for a person.

**This reverses `--restart`'s own stated rule, and the reversal is deliberate.** That verb refuses to auto-select a branch because *"replacing a stopped worker rather than reviewing, reaping or abandoning its work is a person's call."* The measurement that overrides it: on 2026-09-11 four agents stopped, three held finished work, and every one sat untouched until a person read `ps`. The call was the operator's and the operator was not looking.

### A failed build becomes a correction (Branch: feature/a-failed-gate-becomes-a-correction)

The correction file in the desk, the loop's consumption of it, the attempt budget, and the superseded-sha discard.

The BuildMonitor's `build failed` finding becomes a file the loop reads on its next pass, resuming the agent's session with the failure text verbatim. The budget is the loop's, read from config; an agent cannot extend it by declaring itself unfinished.

**A correction about a superseded sha is discarded, not delivered** — the monitor already distinguishes `head moved`, and a failure about a sha the agent has replaced is answered by work already done.

### A marker names its writer (Branch: feature/a-marker-names-its-writer)

Branch and agent on every `PLOT-BLOCKED` marker.

Independent of both slices above — a marker gains a field whether or not corrections exist — but it belongs here because a correction loop raises the rate of markers, and a marker written by one branch's worker into another's tree already made a finished branch read as blocked.

## Notes

This is the slice that changes what the fleet *is*. Plot's gates stop things; after this, one class of gate corrects them. A fleet whose every failure ends at a person is parallel and supervised, not autonomous.
