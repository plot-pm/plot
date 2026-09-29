# Panel — a tick asks the host once (#1059)

Subject: `docs/plans/2026-09-29-a-tick-asks-the-host-once.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

**The strongest instrumentation of the session.** The juror ran a real `plot-registryd.mjs --once` with a counting `plot-host.sh` in a shadow scripts dir, spent 3 host calls total, and verified the tracked script byte-identical (260859 bytes) before and after. The moderator re-verified that.

## THE COST PREMISE IS REFUTED BY MEASUREMENT

**4 host calls on 321 slices and 2 agents, with `queuedHasLanded` firing ZERO times.**

It is gated on `claimable && briefPresent` (`queue-reading.ts:206-212`), and `claimable` means every prior slice is complete — **so at most one slice per plan is ever asked about.**

**The bound is documented eighteen lines above the code the plan quoted** (`:156-165`), carrying its own 454-slice measurement and making the plan's argument already:

> This estate had **454 queued slices** on the tick that found the defect, and a daemon asking the host about every one of them each minute would spend its whole budget … So the question goes only to a slice that `isHandOverReady` would otherwise pass.

The plan read downward from `:188` and never read up. **The operator's `merge-unknown=4` is that bounded population, not unbounded fan-out.**

## A THIRD CALL SITE, AND A REAL DUPLICATE

The plan named two sites and cited `supervisor.ts:332` as their shared resolution hop. **It is a third, independent one:** `supervisor.ts:186` → `:332` → `registryd-main.ts:290`.

The instrumented tick shows **the same branch asked twice in one pass** — 2 of the 4 calls are a pure duplicate.

**The fix is in the same file.** `registryd-main.ts:272` is a per-tick memo cleared by `beginTick`, used for `planLines`. The plan ruled a memo out by name; that exclusion is withdrawn.

## THE DECISION PROCEDURE RETURNED THE WRONG ANSWER

The plan asked the slice: *does `mergedBranches` carry the fact `landed` needs? If not, add a second bundled call.*

**It answers YES — and an implementer acting on it ships promote-on-silence.** `rules/landed.ts:61` reads only `readings.merged`, and the caller already passes `open: 'unaskable'`. But `registryd-main.ts:435` returns a **bare `Set`** on `!answer.ok`, collapsing `unaskable` into `none`.

**The hazard is the return type discarding a third value, not a missing fact.** Wrong disjunction, wrong remedy — and the failure mode it would have produced is a host outage reading as *nothing has landed*.

## THE BETTER ACCOUNT OF THE INCIDENT — filed as #1065

The board runs the same cadence and behaves: one bundled `pr-list --rich`, `withHostSlot`, rate-aware backoff, a cadence that stretches (`rules/cadence.ts:57`). The supervisor has **none** — zero hits for `spendRate`, `recordSpend`, `withHostSlot`.

**Under a 429 the board throttles and the supervisor keeps asking at a fixed 60 s.** Four calls a minute is not much; four calls a minute that never slow down is the incident.

Split into **#1065** rather than folded in, because a slice that fixed the duplicate and claimed the 429 would be the last time anyone checked.

## One more, small and real

`supervisor.merge('')` fires for every free agent — `sliceHasMerged` guards the empty branch and `supervisor.merge` does not. Refused locally so no quota cost, but `registryd-main.ts:291` maps it to `'unreachable'`, feeding a spurious merge reading into the rule each tick.

## Why amend and not reject

The reported incident is real, the duplicate is a genuine defect one citation away, and — the juror's own words — *unusually for this author every hop verifies*. The mechanism section is amendable; the cost section had to be replaced.

## Amendments folded in

1. The cost premise replaced with the measurement and the bound the plan missed.
2. The third call site and the duplicate, with the existing memo as the mechanism.
3. The memo exclusion withdrawn.
4. The fold's real hazard — `unaskable` collapsing — with a `Done when` asserting it survives.
5. `supervisor.merge('')` for free agents.
6. The spend-discipline account recorded and filed as #1065.
