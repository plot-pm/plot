# The supervisor says why it handed nothing

> `plot-registryd --once` reports `handed=0 queued=480 idle=8` and stops there. Eight free agents, four queued slices with briefs on `origin/main`, and no way to learn which of six holds refused each one.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #767 merged
- **Delivered:** 2026-09-07

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

**THE REASON IS COMPUTED, CARRIED, AND THROWN AWAY AT THE LAST LINE.** Round 1 traced it:

```
rules/queue.ts:185   whyNotReady()  → one of six holds
rules/queue.ts:237   matchQueue()   → held.push({ branch, hold })
registryd.ts:308     `queued=${queue.held.length}`   ← the reasons stop here
```

`matchQueue` carries a named hold **per branch** all the way to the tick, which counts the entries and discards what each says. So the fix is smaller than this plan first implied and its claim is stronger: nothing needs computing, only printing.

**AND `queued=` IS THE WRONG WORD FOR WHAT IT COUNTS.** It is `held.length` — slices that were **refused**, each with a reason. A field named `queued` reads as *480 slices waiting their turn*; it means *480 slices nothing would take*. That misreading cost an hour of this session.

**`idle=8` COMPLETES THE PICTURE.** `idle` is `free.slice(next)` — the free agents left over after assignment. Eight free, none assigned, so **every one of the 480 hit a hold before `no-free-agent` could apply.** That rules out capacity as the cause and leaves five holds, none of which round 1 could confirm by hand for the four slices it checked.

**Round 1 tried to name the hold and could not.** `no-brief`, `not-claimable`, `already-merged` and `merge-unknown` were each ruled out for those four by direct measurement, and a fifth guess — that the queue reads a phase in the wrong shape — was checked and disproved: `PlanRecord.phase` is normalized lowercase and `DISPATCHABLE_PHASE` is `'approved'`.

**That failure is the plan's argument.** Two people-hours went into re-deriving an answer the code holds in a variable, and the answer still is not known.

**THE COST IS THE WHOLE AFTERNOON'S PATTERN.** Every slice dispatched today was assigned by hand, because a tick that says `handed=0` gives no way to tell *nothing was ready* from *something is wrong*. The supervisor has been running, deciding correctly on four earlier occasions, and its correct decisions were invisible in exactly the same way.

## What this is not

**Not a change to `whyNotReady`.** The rule is right and its six holds are stated. What is missing is a caller that reports them.

**Not a fix for the match itself.** Whether the four should have been handed over is a separate question this plan does not answer — it makes the answer *legible*, which is what any investigation needs first.

**Not a log level.** `handed=0` on a tick that had nothing to hand is correct and quiet. The reason belongs beside the count, not behind a flag.

## Slices

### The tick names its holds (Branch: feature/a-tick-says-what-it-refused) <!-- moved: landed on main as f9c8e151 before this plan was written -->

The supervisor's summary carries a count per hold, and `--once` lists the slices behind each.

**THE COUNTS GO ON THE SUMMARY LINE**, beside `queued=` and `idle=`, because that line is what a person reads on a running daemon and what a log carries. Six holds, six keys, zero where a hold did not fire.

**THE NAMES GO BEHIND `--once`**, which is the operator's inspection path and already prints per-agent decisions. A daemon ticking every 60 s must not print 480 slice names.

**`queued=480` IS ITSELF SUSPECT AND THIS SLICE WILL SAY WHY.** The estate holds 207 plans; 480 queued slices means the count includes slices no agent could ever take. Whatever `whyNotReady` says about them is the answer, and the counts will show it.

**`queued=` IS RENAMED IN THE SAME SLICE.** It counts refusals, and every reader of that line draws the opposite conclusion from its name. `held=` says what it is; the per-hold counts say why.

**Done when** a tick that hands nothing over reports which hold stopped each slice, the count of refusals is not named `queued`, `--once` names the slices per hold, and a tick with a genuinely empty queue still prints `handed=0` without noise.

## Notes

### Why this outranks fixing the match — 2026-09-06

I spent an hour of this session checking four inputs by hand — brief presence, claim refs, host answers, agent freedom — to conclude that all four were correct and the match should have happened. **`whyNotReady` would have answered in one line.**

A wrong match that says why is a bug report. A correct match that says nothing is indistinguishable from a wrong one, and that is what made the afternoon's hand-assignment feel necessary.

### Round 1 — 2026-09-06

**The round was an investigation and it ended without the answer**, which is the strongest evidence the plan could have had.

Traced: the hold is computed (`whyNotReady`), carried per branch (`matchQueue`), and discarded at `registryd.ts:308`. Ruled out by measurement for the four hand-assigned slices: `no-brief` (all four on `origin/main`), `not-claimable` (no refs), `already-merged` and `merge-unknown` (`pr-merged` answered `not-merged`), `no-free-agent` (`idle=8`).

Then a fifth hypothesis — the queue reading a phase in the wrong shape — was checked and **disproved**: `plan-store-shell.ts:97` reads `plot-plan-meta.sh`'s normalized lowercase `phase`, and `DISPATCHABLE_PHASE` is `'approved'`.

**Five candidates eliminated, the cause still unknown, and one line of output would have said it on the first tick.** The investigation stops here rather than continuing to guess.
