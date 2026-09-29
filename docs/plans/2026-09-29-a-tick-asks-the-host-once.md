# A tick asks the host once

> `mergedBranches()` is already one bundled call per pass. Two readings beside it are not: `queuedHasLanded` fires per claimable slice and `sliceHasMerged` once per agent, every 60 s. On Bitbucket that exhausts the account and every slice is held `merge-unknown` while the fleet does nothing.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1059
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A supervisor tick asks the git host a bounded number of times, so a Bitbucket account is not exhausted by the fleet watching itself.

Board impact: fewer host calls per tick. No payload change.

## Motivation

Reported from a Bitbucket estate: **`HTTP 429` twice in two hours**, and while it lasts the tick reads

```
agents=2 … handed=0 merge-unknown=4 no-brief=0 no-free-agent=0
```

Every slice held, nothing handed over, recovery about 20 minutes. **Holding on an unreadable merge state is correct** — promoting on silence would hand out a slice whose predecessor may still be running. The defect is the number of questions, not the caution.

### The bundling exists and two readings sit outside it

`queue-reading.ts:188-195` already records the measurement and the fix:

> **IT IS ONE BUNDLED CALL, NEVER ONE PER BRANCH**, and that was measured rather than assumed. A first version asked `prMerged` per branch: correct, and it took the tick from 25 s to **357 s** across 426 branches … a 14x bill on the one reading with an account and a rate limit behind it, paid every 60 s.

`mergedBranches()` at `:199` is that bundled call. **But the loop underneath it is not bundled:**

- `:212` — `await world.queuedHasLanded(entry.branch)`, per claimable slice carrying a brief
- `:226` — `await world.sliceHasMerged(entry.branch)`, per registered agent

Both resolve through `hostShell.prMerged` (`supervisor.ts:332`, `host-shell.ts:309`). So the estate paid for the lesson once, applied it to one of three readings, and the other two kept the shape the comment forbids.

### Why Bitbucket and not GitHub

`plot-host.sh` is the one place that talks to either host, but the budgets differ: Bitbucket Cloud's per-resource limit is small enough that a handful of slices on a 60 s tick reaches it, and GitHub's has not. **The defect is host-agnostic and only Bitbucket has shown it.**

## Design

### The rule

**A tick asks the host a number of times bounded by the tick, not by the number of slices or agents.**

`mergedBranches()` already answers *which branches merged* for the whole pass. The two per-branch readings ask a question that answer contains.

### The shape, and the one thing the slice must check

Both call sites sit inside loops that already have `merged` in scope (`:205`). The obvious change is to join against it rather than call out.

**`queuedHasLanded` may not be the same question, and the code says so.** `queue-reading.ts:44` states it is *"A DIFFERENT SUBJECT FROM `sliceHasMerged`"*, and its return type is `LandedAnswer` rather than a boolean. **The slice must read that distinction before collapsing anything** — if `landed` needs a fact `mergedBranches` does not carry, the fix is a second bundled call, not a fold into the first.

This is the plan's one open question and it is answerable by reading two functions. It is **not** deferred as a judgement: the slice reads them and records which of the two shapes it found.

### Holding stays

A reading the host cannot answer still holds the slice. This plan reduces how often the question is asked; it does not change the answer to silence.

### What this does NOT do

- **It does not add a cache or an index read.** The supervisor reads no `PrIndexStore` today, and adding one is a larger change with its own layering argument.
- **It does not change the tick interval.** 60 s is `DESIGN-agent.md`'s and a longer one would hide the cost rather than remove it.
- **It does not touch the board's own PR timer**, which is a separate consumer with its own budget.
- **It does not promote on silence.**

## Done when

- **A tick's host-call count does not grow with the number of slices or agents**, asserted by counting calls against a stub at two fleet sizes — the assertion the existing comment's measurement implies and no test makes.
- `queuedHasLanded`'s subject is settled in the PR: either it folds into `mergedBranches`, or it becomes a second bundled call and the PR says what fact forced that.
- An unreadable merge state still holds the slice, asserted.
- The tick's reported counters are unchanged in shape, so an operator comparing two ticks sees the same fields.

## Slices

### A tick asks the host once (Branch: bug/a-tick-asks-the-host-once)

Join the two per-branch readings against the pass's bundled answer, or bundle them separately, and assert the call count does not scale.

## Notes

**The estate already paid for this lesson and applied it partially.** `queue-reading.ts:188-195` is the record of a 14x bill measured on this exact shape; two readings beside it kept the shape anyway. That is worth stating in the fix, because the comment reads as though the problem were solved.

**Reported by an operator on a Bitbucket estate, not found by Plot.** Nothing counts a tick's host calls, which is why a 60 s loop could exhaust an account twice in two hours without any gate noticing.
