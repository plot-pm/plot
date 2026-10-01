# A tick asks the host once

> `mergedBranches()` is already one bundled call per pass. Two readings beside it are not: `queuedHasLanded` fires per claimable slice and `sliceHasMerged` once per agent, every 60 s. On Bitbucket that exhausts the account and every slice is held `merge-unknown` while the fleet does nothing.

## Status

- **State:** Released
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1059
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, jwloka, `bug/a-tick-asks-the-host-once`
- **Delivered:** 2026-09-29
- **Released:** 2026-10-01, v2.22.0

## Changelog

- A supervisor tick asks the git host a bounded number of times, so a Bitbucket account is not exhausted by the fleet watching itself.

Board impact: fewer host calls per tick. No payload change.

## Motivation

Reported from a Bitbucket estate: **`HTTP 429` twice in two hours**, and while it lasts the tick reads

```
agents=2 … handed=0 merge-unknown=4 no-brief=0 no-free-agent=0
```

Every slice held, nothing handed over, recovery about 20 minutes. **Holding on an unreadable merge state is correct** — promoting on silence would hand out a slice whose predecessor may still be running. The defect is the number of questions, not the caution.

### The cost premise was WRONG, and the measurement is what corrects it

An earlier draft claimed the per-branch readings scale with the fleet. **Measured on this estate with a counting `plot-host.sh` wrapper on a real `--once` tick: 4 host calls on 321 slices and 2 agents, and `queuedHasLanded` fired ZERO times.**

It is gated on `claimable && briefPresent` (`queue-reading.ts:206-212`), and `claimable` means every prior slice is complete — so **at most one slice per plan is ever asked about.** The bound is documented eighteen lines above the code this plan quoted (`:156-165`), carrying its own 454-slice measurement and making this plan's cost argument already:

> a daemon asking the host about every one of them each minute would spend its whole budget … So the question goes only to a slice that `isHandOverReady` would otherwise pass.

**The reported `merge-unknown=4` is that bounded population, not unbounded fan-out.** This plan quoted a line eighteen below the refutation of its own premise.

### What the incident actually shows: the supervisor has no spend discipline

The board runs the same 60 s cadence and behaves: **one bundled `pr-list --rich`, a spend record (`withHostSlot`), rate-aware backoff, and a cadence that stretches** (`rules/cadence.ts:57`).

The supervisor has none — zero hits for `spendRate`, `recordSpend` or `withHostSlot` in `registryd-main.ts` or `supervisor.ts`. **Under a 429 the board throttles and the supervisor keeps asking at a fixed 60 s.** That is the account of the Bitbucket incident, and an earlier draft did not contain it.

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

### THE DEFECT: a third call site, and the same branch asked twice per tick

An earlier draft named two call sites and cited `supervisor.ts:332` as their shared resolution hop. **It is not — it is a third, independent one.** `supervisor.ts:186` → `:332` → `registryd-main.ts:290` is its own `prMerged`, and the instrumented tick shows **the same branch asked twice in one pass**: 2 of the 4 calls are a pure duplicate.

**The fix already exists in the same file.** `registryd-main.ts:272` is a per-tick memo, cleared by `beginTick`, used for `planLines`. An earlier draft ruled a memo out by name in *"What this does NOT do"* — that exclusion is withdrawn, because the memo is the estate's own answer to this exact shape.

**Also:** `supervisor.merge('')` fires for every free agent — `sliceHasMerged` guards the empty branch and `supervisor.merge` does not. It is refused locally so it costs no quota, but `registryd-main.ts:291` maps it to `'unreachable'`, feeding a spurious merge reading into the rule every tick.

### The fold is possible and the earlier decision procedure returned the WRONG answer

An earlier draft told the slice to ask *"does `mergedBranches` carry the fact `landed` needs?"* and, if not, to add a second bundled call.

**That question answers YES, and an implementer acting on it ships promote-on-silence.** `rules/landed.ts:61` reads only `readings.merged`; the caller already passes `open: 'unaskable'`, saying it is unread. But `registryd-main.ts:435` returns a **bare `Set`** on `!answer.ok`, collapsing `unaskable` into `none`.

**The hazard is the return type discarding a third value, not a missing fact** — so the disjunction was wrong and so was its remedy. A fold must preserve *unaskable* as distinct from *not merged*, or a host outage reads as *nothing has landed* and the supervisor promotes on silence.

### Holding stays

A reading the host cannot answer still holds the slice. This plan reduces how often the question is asked; it does not change the answer to silence.

### What this does NOT do

- **It does not add a `PrIndexStore` read.** The supervisor reads no store today and adding one is a larger change with its own layering argument. **A per-tick memo is not that** — `registryd-main.ts:272` already has one, and this plan uses it.
- **It does not change the tick interval.** 60 s is `DESIGN-agent.md`'s and a longer one would hide the cost rather than remove it.
- **It does not touch the board's own PR timer**, which is a separate consumer with its own budget.
- **It does not promote on silence.**

## Done when

- **No branch is asked about twice in one tick**, asserted by counting calls against a stub. Measured today: 2 of 4 calls were a pure duplicate of one branch.
- **The per-tick memo is the mechanism**, following `registryd-main.ts:272`, and it is cleared by `beginTick` like the existing one.
- **`unaskable` survives the fold**, asserted with a stub whose host call fails: a slice must read *unaskable*, never *not merged*. `registryd-main.ts:435` returns a bare `Set` on `!answer.ok` today, which is the collapse this must not inherit.
- **`supervisor.merge('')` is not called for a free agent**, asserted — it is refused locally but maps to `'unreachable'` and feeds a spurious reading into the rule each tick.
- An unreadable merge state still holds the slice, asserted.
- **The supervisor's lack of spend discipline is recorded, not fixed here.** The board has `withHostSlot`, a spend record and a stretching cadence (`rules/cadence.ts:57`); the supervisor has none, so under a 429 it keeps asking at a fixed 60 s. That is the Bitbucket incident's likelier cause and it is **#1065** — naming it here is what stops this slice being mistaken for the fix.
- The tick's reported counters are unchanged in shape.

## Slices

### A tick asks the host once (Branch: bug/a-tick-asks-the-host-once, PR: #1070)

Memo the per-tick merge readings so no branch is asked twice, preserving `unaskable` as distinct from *not merged*, and stop asking for an empty branch.

## Notes

**The estate already paid for this lesson and applied it partially.** `queue-reading.ts:188-195` is the record of a 14x bill measured on this exact shape; two readings beside it kept the shape anyway. That is worth stating in the fix, because the comment reads as though the problem were solved.

**Reported by an operator on a Bitbucket estate, not found by Plot.** Nothing counts a tick's host calls, which is why a 60 s loop could exhaust an account twice in two hours without any gate noticing.


### Round 1, 2026-09-29

One juror, **amend**, **executed** — it instrumented a real `--once` tick with a counting `plot-host.sh` in a shadow scripts dir, made 3 host calls total, and verified the tracked script byte-identical before and after.

**The cost premise was refuted by measurement.** 4 host calls on 321 slices and 2 agents, `queuedHasLanded` firing **zero** times: it is gated on `claimable && briefPresent`, so at most one slice per plan is ever asked. **The bound is documented eighteen lines above the code this plan quoted**, with its own 454-slice measurement making the same argument. An earlier draft read downward from `:188` and never read up.

**A third call site existed and this plan misread it as plumbing.** `supervisor.ts:186` is independent, and the same branch is asked twice per tick — half the calls measured.

**The earlier decision procedure returned the wrong answer.** *"Does `mergedBranches` carry the fact?"* answers YES, and an implementer following it ships promote-on-silence, because `registryd-main.ts:435` collapses `unaskable` into a bare `Set`. The hazard was the return type, not a missing fact.

**And the incident has a better account than this plan gave:** the supervisor has no spend discipline at all where the board has `withHostSlot`, a spend record and a stretching cadence. Recorded here, filed as #1065, deliberately not folded in — a slice that fixed a duplicate and claimed the 429 would be the last such claim anyone checked.
