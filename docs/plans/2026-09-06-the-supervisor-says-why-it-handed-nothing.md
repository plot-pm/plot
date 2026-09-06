# The supervisor says why it handed nothing

> `plot-registryd --once` reports `handed=0 queued=480 idle=8` and stops there. Eight free agents, four queued slices with briefs on `origin/main`, and no way to learn which of six holds refused each one.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A tick that hands nothing over says which hold stopped each slice, so an operator can act on the reason instead of re-deriving it.

<!-- Board impact: the board renders the tick's decision; a named hold is a
     column it could show. This plan adds the reason, not the rendering. -->

## Motivation

**Measured 2026-09-06.** Four slices were dispatched, each with a brief pushed to `origin/main`, against eight agents reading `state: running, branch: ""` — free by `isAgentFree`. The tick answered:

```
plot-registryd tick agents=8 left=8 reap=0 correct=0 person=0 defer=0 handed=0 queued=480 idle=8
```

**Every input checked out by hand.** The controller reported all four as `state: open, brief: present`; no branch carried a ref, so none was claimed; `plot-host.sh pr-merged` answered `not-merged` for each. **Nothing in the output said why the match did not happen**, and the four were assigned by writing `branch` into a manifest — which the agents took within 80 seconds.

**`whyNotReady` ALREADY COMPUTES THE ANSWER.** `rules/queue.ts:185` returns one of six holds:

```
already-merged   merge-unknown   no-brief   not-claimable   (and two more)
```

The rule names the reason and the tick discards it. That is the shape this repo keeps finding — a correct rule whose answer nothing carries — and it is why an operator ends up re-deriving by hand what the domain had already decided.

**THE COST IS THE WHOLE AFTERNOON'S PATTERN.** Every slice dispatched today was assigned by hand, because a tick that says `handed=0` gives no way to tell *nothing was ready* from *something is wrong*. The supervisor has been running, deciding correctly on four earlier occasions, and its correct decisions were invisible in exactly the same way.

## What this is not

**Not a change to `whyNotReady`.** The rule is right and its six holds are stated. What is missing is a caller that reports them.

**Not a fix for the match itself.** Whether the four should have been handed over is a separate question this plan does not answer — it makes the answer *legible*, which is what any investigation needs first.

**Not a log level.** `handed=0` on a tick that had nothing to hand is correct and quiet. The reason belongs beside the count, not behind a flag.

## Slices

### The tick names its holds (Branch: feature/a-tick-says-what-it-refused)

The supervisor's summary carries a count per hold, and `--once` lists the slices behind each.

**THE COUNTS GO ON THE SUMMARY LINE**, beside `queued=` and `idle=`, because that line is what a person reads on a running daemon and what a log carries. Six holds, six keys, zero where a hold did not fire.

**THE NAMES GO BEHIND `--once`**, which is the operator's inspection path and already prints per-agent decisions. A daemon ticking every 60 s must not print 480 slice names.

**`queued=480` IS ITSELF SUSPECT AND THIS SLICE WILL SAY WHY.** The estate holds 207 plans; 480 queued slices means the count includes slices no agent could ever take. Whatever `whyNotReady` says about them is the answer, and the counts will show it.

**Done when** a tick that hands nothing over reports which hold stopped each slice, `--once` names the slices per hold, and a tick with a genuinely empty queue still prints `handed=0` without noise.

## Notes

### Why this outranks fixing the match — 2026-09-06

I spent an hour of this session checking four inputs by hand — brief presence, claim refs, host answers, agent freedom — to conclude that all four were correct and the match should have happened. **`whyNotReady` would have answered in one line.**

A wrong match that says why is a bug report. A correct match that says nothing is indistinguishable from a wrong one, and that is what made the afternoon's hand-assignment feel necessary.
