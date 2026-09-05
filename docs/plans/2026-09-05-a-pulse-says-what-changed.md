# A pulse says what changed

> The scan re-derives the whole estate every run and prints a full picture. Nothing says what moved since the last one, so a reader compares 47 slices by eye — and the supervisor, which tries, gets it wrong.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A pulse reports what changed since the previous one — merged PRs, dead workers, slices that became eligible — instead of leaving a reader to diff two full pictures.

<!-- Board impact: the delta reads `last-pulse.json`, which the board already
     writes. No new store, no plan-format change. -->

## Motivation

**The story asks for this by name.** `STORY-the-master-agent-holds-the-fleet.md:220`, job 3:

> **Wanted:** a delta. *Since your last pulse: 2 PRs merged, 1 worker died, 3 plans became deliverable.* This is also what an operator's status update wants, which is why it belongs here rather than in the board.

**And it measures the cost of not having one:** *"The scan re-derives the whole estate every run and prints a full picture; the supervisor diffs it against memory, badly. Four of tonight's corrections were 'I said X, and X had already changed.'"*

**THE DEFERRAL'S OWN CONDITION HAS CLEARED.** The story's Open Points deferred this explicitly, and named what it was waiting for: `production-calls-the-domain-one-rule-at-a-time` *"excludes it because new capability during a migration leaves the corpus tests with nothing to compare against — production would hold no implementation of the new rule. It needs its own plan once the domain is the only implementation."*

Verified 2026-09-05: that plan is **Released**. The condition is met and this is the plan it called for.

**The estate is large enough that the delta is the only readable form.** Measured the same day: **13 plans, 47 slices, 48 branches.** A full picture is the right output for a first read and the wrong one for the tenth.

## The state to diff against already exists

**`.plot/state/last-pulse.json` is written by the board today** — 30 KB on this estate, `pulse-bridge.ts:101`. It carries a whole prior pulse plus `ages`, `approvedAt` and `ideaPlans`.

**Three of its properties decide this plan's shape:**

**It is machine-local and gitignored**, and the file says why: *"A checked-in pulse would be one repository telling another what its branches are doing."* So a delta is a statement about this machine, never about the estate globally.

**It expires.** `BRIDGE_MAX_AGE_MS` is 15 minutes (`:70`), past which *"the honest answer is no"*. A delta therefore has three outcomes, not two: what changed, nothing changed, and **too long since the last pulse to say** — and the third must be distinguishable from the second.

**It is versioned.** `:193` returns null on a version mismatch, so a schema change degrades to *cannot say* rather than to a wrong answer.

## What this is not

**Not a new store.** The bridge exists, is written, expires and is versioned. Adding a second record of the same estate is the drift this repo keeps measuring.

**Not a change to the scan's statelessness.** `plot-fleet-scan.sh` re-derives everything from git every run and must keep doing so — the pulse line it appends is its only write. The delta is computed by comparing two derivations, not by the scan remembering one.

**Not a board feature.** The story places it deliberately: *"This is also what an operator's status update wants, which is why it belongs here rather than in the board."* The board may render it; the answer is the fleet's.

## Slices

### The delta is a domain rule (Branch: feature/a-pulse-says-what-changed)

A function from two pulses to what moved between them, in `packages/domain/src/rules/`.

**READINGS AS VALUES, AS EVERY RULE HERE IS.** Two pulses in, a delta out — no port, nothing awaited, no I/O. The caller reads `last-pulse.json`; the rule compares. That is what makes it testable against recorded estates rather than against a live one.

**THREE OUTCOMES, NOT TWO.** *Changed*, *unchanged*, and *cannot say*. The third covers an absent file, a version mismatch and a pulse older than `BRIDGE_MAX_AGE_MS` — three causes, one answer, and it must never render as *nothing changed*. A quiet estate and an unreadable history look identical to a reader and mean opposite things.

**WHAT COUNTS AS A CHANGE IS THE SLICE'S REAL WORK.** The story names three kinds — a PR merged, a worker died, a plan became deliverable — and the pulse carries more than those. The rule reports transitions that a reader would act on, and says which kinds it covers; a delta over every field would re-print the estate with extra words.

**Done when** two pulses yield a delta, an expired or absent previous pulse says *cannot say* rather than *nothing changed*, and the rule performs no I/O.

### The pulse reports it (Branch: feature/the-pulse-line-carries-the-delta)

`/plot-pulse` prints the delta above its full report, and the fleet scan's pulse line carries the same answer.

**THE FULL PICTURE STAYS.** A first read needs it, and a delta with nothing to compare against is the `cannot say` case. The delta leads because it is what a returning reader wants; the picture follows because it is what a new one does.

**Done when** `/plot-pulse` leads with what changed, a first run says so plainly, and the full report is unchanged below it.

## Notes

### Why this is not the supervisor's — 2026-09-05

The supervisor already *"diffs it against memory, badly"*, and its statelessness is a measured property: a daemon `kill -9`ed two seconds into a 3.4 s tick reached the identical decision on the next pass, with no state file written. Giving it a memory to diff against would trade that for a convenience the bridge already provides from disk.
