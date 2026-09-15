# Panel — the-tight-band-remembers-what-it-started

Subject: `docs/plans/2026-09-15-the-tight-band-remembers-what-it-started.md` (Draft)
Lenses: premise, ratchet, callers. Reconciliation: **unanimous — amend**.

**The word is unanimous and the reasoning is not.** Two jurors found the plan's
central premise false; the third found its scoping decision correct and better
argued than the plan states. Both are right, and the moderation does not average
them.

## The decisive finding: the 63 tight passes dispatched NOTHING

**`premise`'s finding, verified by the moderator.**

```
dispatching anyway lines : 63
dispatches in the log    :  0
board boot banners       :  8
```

**The tight line prints once per 5-second pulse, whether or not anything is
startable.** The deferral line eight lines above it is gated on eligible work —
`auto-dispatch.ts:1044-1049`, *"a deferral with nothing to dispatch is routine,
not a decision anybody needs to read every five seconds"* — and **the tight line
at `:1058` has no such gate**, printing before `planAutoDispatch` is ever called.

**So 63 is a cadence, not a count of forks.** The plan reads 63 print statements
as 63 dispatches: *"Each pass reads `tight`, dispatches one more."* That is the
error class the plan's own Notes cite four rejections for, committed in the plan
about that error class.

**The 84 processes are therefore unattributed.** Nothing joins them to the
board's auto-dispatch. `.plot/logs/registryd.log` is 67 MB, modified in the same
window, and `--start-agents` starts up to three desks per tick — and the plan
scopes the supervisor out, then attributes the count to the component it keeps
in.

## The ratchet would ship a board that stops

**`ratchet`'s finding, verified by the moderator against the plan's own data:**

```
clearBelowMs                        : 10
lowest reading in 102 measurements  : 41.0 ms
clear readings observed             : ZERO
```

**The proposed reset condition did not fire once.** The plan contains the
sentence *"a ratchet that never resets is a refusal wearing another name"* — and
that describes what it ships. The `Done when` pins reset with a synthetic
`clear` reading the incident never produced.

**Worse than the sibling this panel was warned about.** The ceiling panel found
`loweredConcurrency` only ever falls, recoverable by restart — that ratchet pins
a board at *slow*. This one pins it at **stopped**, and the plan specifies no
escape.

**And the latch's home is unspecified between two opposite answers.**
`CacheEntry` carries `briefsAsked` as cross-pass state — and also
`prConcurrency`, the exact ratchet a sibling panel condemned an hour ago. The
plan says *"one bit beside the existing controls"*, but the controls
(`autoDispatch`, `parallelAgents`, `machineOverride`) are operator-settable and
persisted while `CacheEntry` is neither. **Who resets it has two answers and the
plan gives neither.**

**A fourth headroom value is never mentioned.** `HeadroomSchema` is
`['clear','tight','starved','unmeasured']`. A ratchet keyed on *not clear*
latches permanently when sampling fails; one keyed on *clear resets* never
releases. Both pass every listed gate, and they differ by *a fleet that never
starts again*.

## The disagreement, named: the scoping decision is RIGHT

**`callers` reached the opposite conclusion on the one question the other two did
not ask, and its evidence holds.** Verified by the moderator:

| | board auto-dispatch | `plot-registryd` |
|---|---|---|
| cadence | **5 s** | 60 s tick |
| band ceiling | **none** | `TIGHT_CEILING = 2`, `STARVED_CEILING = 1` (`fleet-size.ts:88,99,166-167`) |
| subtracts running | no | **yes** — `wanted = requested - running` (`:130`) |
| per-tick rate limit | none | `DESKS_PER_TICK = 3` |

**The supervisor already implements the memory this plan proposes to add**, and
is bounded twice over. The board runs at **12 dispatch decisions per minute
against the supervisor's one tick**, with no band-aware bound at all.

**So fixing the board is not one of three equal fixes — it is the fix to the only
caller with no band-aware bound.** The plan's scoping decision is correct, and
better argued by this juror than by the plan.

**The three share `parallelAgents` and the registry, and share NOTHING of the
in-flight window or the machine reading** — three independent samples of one
quantity, no coordination. That is a real finding and it is not this plan's.

## What the lenses had in common

**All three verified the code claims and all three accepted that an incident
occurred.** None asked whether the board caused it until `premise` did. The
plan's framing — *"during a live incident"*, *"the machine spent the entire
incident parked"* — describes **six board sessions across 8 restarts**, and the
plan states it as one continuous event.

Also unreproduced: the median is **46.6**, not 46.4, and the `Done when` names
41.0/46.4/50.0 as *"the measured sequence"* — so the fixture would encode a
number the log does not contain. Third document this week whose stated figure
does not re-derive.

## What this panel supports

**Reject the plan. Keep two findings and give each its own.**

1. **The board's loop is the unbounded caller** — 5 s cadence, no band ceiling,
   no subtraction of running agents, while the supervisor has all three. **That
   is a real defect and `callers` established it.** The fix is not a latch; it is
   the ceiling the supervisor already has (`ceilingFor`), applied to the caller
   that lacks it. No new state, no reset condition, no ratchet.
2. **Three spawners share no in-flight window and no machine reading.** Each
   samples independently. That is the finding the incident actually supports.

**What must not be carried forward:** the claim that the board dispatched 63
times, the process attribution, and any ratchet whose reset was never observed.

**The thresholds are marked *"Provisional: they come from one session's samples
and are to be re-measured"* (`machine.ts:18-19`) and never were.** A plan that
tunes behaviour around them should re-measure first.
