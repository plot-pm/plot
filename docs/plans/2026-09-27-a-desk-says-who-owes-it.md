# A desk says who owes it

> A desk with no live worker has three causes and one appearance, so an operator intervenes where the fleet would have acted. Measured 2026-09-27: **eleven claim refs cleared by hand in one session**, and of two desks that looked stalled, the fleet had already restarted one and legitimately deferred the other. The supervisor computes the reason every tick — `supervision.ts:139` types nine of them — and discards it after printing.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1030
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 0

## Changelog

- A desk says why it has no worker: deferred on headroom, being restarted, or genuinely stuck. Only the third asks for a person, and only the third appears in WAITING ON YOU.

Board impact: **yes.** The supervision cause reaches the fleet payload and the row. No new derivation — the value already exists.

## Motivation

**Three causes, one appearance.**

```
deferred on headroom        → the fleet will start it. Do nothing.
worker died                 → the fleet will restart it. Do nothing.
never started, not deferred → needs a person.
```

All three look the same: a desk, a claim, no live pid.

### The supervisor knows and the board does not

```
plot-registryd tick agents=3 ... defer=1 ... no-free-agent=0
  : defer (no-headroom)
```

`/api/fleet` for that same desk, at that moment:

```
group:     waiting-on-you
state:     wip
note:      PR #1026 green
worker:    none
```

`worker: none` is true and says nothing about who owes the desk. The row sits in **WAITING ON YOU** — the section whose subject is *what needs a person* — for a desk the fleet had queued and would have served itself.

### What it cost, measured

**Eleven claim refs cleared by hand in one session**, plus four `--restart` calls made directly against `plot-dispatch.sh`, each behind an `--unowned-action` receipt on a machine where the board was answering. All 24 escapes in `.plot/state/unowned-action-writes.tsv` are `dispatch`; **15 of them were that session**.

Then measured afterwards: of two desks that looked stalled, **the fleet had already restarted one** — running 20 minutes, predating the operator's attempt by sixteen — and **deferred the other on the machine bound**, which is `rules/fleet-size.ts` working.

**Neither needed a person.** So an unknown share of those eleven were desks the fleet would have served, cleared before it got the chance.

### The value exists and is typed

`supervision.ts:130` already declares nine causes:

```ts
export type SupervisionCause =
  | 'worker-alive' | 'gates-passed' | 'gates-failed'
  | 'declaration-absent' | 'declaration-unreadable' | 'agent-blocked'
  | 'budget-spent' | 'no-progress' | 'no-headroom';
```

And its docstring states the intent this plan completes: *"The correction and the resume handle travel WITH the verdict rather than being re-derived by the caller."* The cause travels with the verdict as far as the tick's stdout, and no further.

## Design

### The rule

**A row carries the supervision cause for its desk, and WAITING ON YOU admits only the desks that owe a person.**

A desk deferred on headroom, or whose worker the fleet is restarting, is the fleet's to answer. It belongs in WORKING or a queue, not in the section that means *go look at this*.

### No new derivation

The cause is computed each tick and typed. This carries it: tick → registry → fleet payload → row. **A second computation anywhere is the defect this fixes, reproduced.**

### Which causes ask for a person

`agent-blocked`, `budget-spent`, `declaration-absent` and `declaration-unreadable` are a person's. `no-headroom` and `worker-alive` are not. `no-progress` is the open one — it is what the fleet restarts on, until the correction budget is spent, and then it becomes a person's.

**The slice states the mapping and argues it**, because that mapping is the whole behaviour and a wrong entry sends work to the wrong reader.

### What this does NOT do

- **It does not change what the fleet recovers.** Measured: the fleet restarts a died worker and defers correctly. #1027 claimed otherwise and was corrected. This is what an operator sees, not what the fleet does.
- **It does not add a controller verb.** Whether `restart` and `release` should exist is #1027's question and is not answered here.
- **It does not change the reaper.** #1015 and #1024 are about desks that cannot be cleaned up; this is about desks that need nothing.
- **It does not remove WAITING ON YOU rows that genuinely need a person.** The section keeps its subject; it stops admitting rows that do not match it.

## Done when

- A desk deferred on headroom shows that reason and is not in WAITING ON YOU.
- A desk whose worker the fleet is restarting shows that, and is not in WAITING ON YOU.
- A desk in neither state is in WAITING ON YOU with its cause named.
- The cause is carried, never recomputed — one producer, asserted by a test.
- The mapping from the nine causes to *owes a person* is written down with its argument.

## Slices

### A desk says who owes it (Branch: `bug/a-desk-says-who-owes-it`)

Carry `SupervisionCause` to the row, state the mapping, and place the sections by it. One slice: the value exists, the transport is the work, and splitting transport from placement would ship a field nothing reads.

## Notes

This plan exists because its absence was measured in operator behaviour rather than in code. Eleven interventions, an unknown share of them unnecessary, by an operator who had read the fleet's own rules that day — the information needed to act correctly was computed and thrown away.

**Three sibling issues share the theme and are deliberately not folded in**: #1027 (a dispatch returns before a worker exists), #1015 (a finished worker can be neither stopped nor reaped), #1024 (three reaper refusals compose). Each needs its own evidence, and one plan spanning four would produce slices colliding on the same files.
