# The board loop reads the same ceiling

> The supervisor bounds a start by what the machine reading came to; the board's loop, deciding twelve times a minute, does not ask.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-15, jwloka, in-session
- **Started:** 2026-09-15, jwloka, `bug/the-board-loop-reads-the-same-ceiling`
- **Delivered:** 2026-09-15

## Changelog

- The board's auto-dispatch loop bounds a start by the machine's headroom, the way the fleet supervisor already does. The two callers read the same reading and only one acted on it.

<!-- Board impact: this IS a board change — one bound in the auto-dispatch
     loop. No plan format, no template, no layout. -->

## Design

**Two callers dispatch agents on this estate and they are not equally bounded.**
Measured 2026-09-15:

| | board auto-dispatch | `plot-registryd` |
|---|---|---|
| cadence | **5 s** | 60 s tick |
| band ceiling | **none** | `TIGHT_CEILING = 2`, `STARVED_CEILING = 1` |
| subtracts running | no | **yes** — `wanted = requested - running` |
| per-tick rate limit | none | `DESKS_PER_TICK = 3` |

**The supervisor asks how big the fleet should be and subtracts reality**
(`fleet-size.ts:130`); the board asks whether one more fork is affordable and
subtracts only its own in-flight marks (`auto-dispatch.ts:478`,
`budget = controls.parallelAgents - (liveCount + inFlight.size)`).

**So the board makes twelve dispatch decisions per minute against the
supervisor's one, with no band-aware bound at all.** That asymmetry is the
defect, and it is the whole defect.

### The rule already exists and is not reachable

`ceilingFor` (`fleet-size.ts:163-171`) answers *the most agents one start may
bring up at this headroom*: `starved → 1`, `tight → 2`, and
`clear`/`unmeasured` → `Infinity`, because *"the machine is not vetoing, so the
request is what bounds the start"*.

**It is NOT exported** — `const ceilingFor`, module-private — and
`auto-dispatch.ts` imports nothing from `fleet-size.ts`. **So the board's loop
cannot ask today**, and that is the smallest true statement of the gap.

**This plan exports it and calls it.** The bound becomes
`min(existing budget, ceilingFor(headroom))`, and every number stays where it is.

### Why a ceiling rather than a latch

**A rejected sibling proposed cross-pass state** —
[`the-tight-band-remembers-what-it-started`](2026-09-15-the-tight-band-remembers-what-it-started.md),
a ratchet where a `tight` reading forbade the next dispatch until `clear`. It was
rejected because **`clear` was observed zero times in 102 readings** (lowest
41.0 ms against a 10 ms threshold), so the reset never fired and the board would
have stopped permanently.

**A ceiling has no such failure mode, and "pure function" is not why.** A pure
function can still pin a system if the quantity it bounds is a **level**. What
saves this one is that **the bounded quantity is a difference**: the budget is
`parallelAgents - (liveCount + inFlight.size)`, a shortfall that shrinks to zero
on its own as agents come up. The rejected sibling gated on a **reset event** that
never occurred; this gates on a shortfall that closes itself, so there is no
reset condition to fail to fire.

**Measured on this estate**, where the board is effectively always `tight` — the
lowest of 102 readings was 41.0 ms against a 10 ms `clear` threshold: a ceiling
of 2 per 5-second pulse is a **ramp rate of 24 agents/minute**. The fleet reaches
`parallelAgents = 3` in **two pulses** and 6 in three. **No plausible cap makes
it binding.** The latch pinned a board at *stopped*; this converges to the cap in
under fifteen seconds.

It holds no state, needs no reset, and cannot latch. `starved` still permits **one**
— deliberately, `fleet-size.ts:78-82`: *"A starved machine that starts nothing is
a fleet that can never recover on its own."*

**And it is the same answer the supervisor already gives**, so the two callers
stop disagreeing about one reading rather than gaining a second rule.

### The board cannot call `fleetSize`, and that is why the export is the honest route

`fleetSize` takes `FleetSizeReadings {requested, running, spawnCostMs, headroom}`.
**The board holds neither `requested` nor `running` in the shape that rule
means** — it holds a slot budget already net of `liveCount` and its own in-flight
marks. A board calling `fleetSize` would have to invent two of its four inputs.

**So `ceilingFor` is not a private helper being promoted for convenience.** It
reads only `headroom` and answers only a ceiling — a rule in its own right,
private by history rather than by design, gaining its first legitimate second
caller.

### `starved` never reaches this caller, and the plan must not pretend otherwise

**The board already dispatches zero on `starved`, before the budget line runs.**
`machineDefers` (`auto-dispatch.ts:411-419`) returns a deferral when
`dispatchDefers(machine)` — `headroom === 'starved'` (`machine.ts:115`) — and the
loop returns at `:476`, while the budget is computed at `:478`.

**So `STARVED_CEILING = 1` is unreachable from the board**, except under
`controls.machineOverride`, which is the operator saying *now anyway*. This plan
therefore changes nothing about `starved` and pins that it changed nothing,
rather than pinning a ceiling the caller cannot reach.

### What this does not do

**It does not change a threshold.** `HEADROOM_THRESHOLDS` stays
`{clearBelowMs: 10, starvedAboveMs: 50}` — and it is marked *"Provisional: they
come from one session's samples and are to be re-measured"* (`machine.ts:18-19`).
**Re-measuring is a separate plan**, and tuning them inside this one would move
two things at once.

**It does not add state.** No latch, no ratchet, no reset condition — that is the
rejected sibling's shape and its failure.

**It does not count processes.** Two agents produce twelve processes; a
per-process cap is a different rule needing a different reading.

**It does not unify the callers.** The three spawners share `parallelAgents` and
the agent registry and share **nothing** of the in-flight window or the machine
reading — three independent samples of one quantity. That is the larger finding
and it is its own plan.

**It does not claim the board caused the 2026-09-15 incident.** Measured: 63
`dispatching anyway` lines and **zero** dispatches in that window, because the
line prints per pulse rather than per fork. The process count is unattributed,
and this plan bounds a caller that is genuinely unbounded rather than one proven
to have misbehaved.

## Slices

### The board loop reads the same ceiling (Branch: bug/the-board-loop-reads-the-same-ceiling)

- `bug/the-board-loop-reads-the-same-ceiling` — export `ceilingFor` from `rules/fleet-size.ts` and bound the auto-dispatch budget by it, leaving every threshold, the `clear` path and the supervisor untouched → #920

**Done when** `ceilingFor` is exported and the auto-dispatch budget is
`min(parallelAgents - (liveCount + inFlight.size), ceilingFor(headroom))`, pinned
by a test; a `tight` reading bounds one pass to **2** and a `starved` one to
**1**, pinned per band with the numbers read from `TIGHT_CEILING` and
`STARVED_CEILING` rather than written literally, so a change to either cannot
leave the test asserting a stale number; **`clear` and `unmeasured` produce
behaviour byte-identical to today's**, pinned by a test, since `ceilingFor`
answers `Infinity` for both and `min` must therefore change nothing — this is the
gate that proves no healthy machine is slowed; **a `starved` reading still
permits one dispatch rather than zero**, pinned explicitly, because
`fleet-size.ts:78-82` says a starved fleet that starts nothing cannot recover;
**no cross-pass state is introduced**, checked by asserting the decision is a
pure function of one reading and the existing budget — two identical passes with
no dispatch between them must produce identical answers; `HEADROOM_THRESHOLDS` is
unchanged, asserted literally; the supervisor's own path is untouched, pinned by
its existing `fleet-size` tests still passing unmodified; and
`pnpm run test:contracts` and the board suite pass.

## Notes

**Supersedes [`the-tight-band-remembers-what-it-started`](2026-09-15-the-tight-band-remembers-what-it-started.md)**,
rejected 2026-09-15 after a three-lens panel. That plan named the right caller
and the wrong mechanism: its premise counted log lines as dispatches, and its
ratchet's reset condition was never observed on the estate it was written from.

**Amended 2026-09-15 after a three-lens panel**
(`.plot/panels/2026-09-15-the-board-loop-reads-the-same-ceiling/panel.md`),
unanimous `amend`. **The premise survived** — the first plan on this subject
whose central reading no juror could falsify. The panel found one gate the code
cannot satisfy (`starved` never reaches this caller), a citation off by one line,
and that the plan's best argument was stated weakly: what prevents a latch is
that the bounded quantity is a difference rather than a level, measured at a ramp
of 24 agents/minute.

**The panel's `callers` lens produced this plan's whole argument** and reached
it while dissenting from its two peers — it was the only lens that asked what the
other spawners do, and found the supervisor already holds the rule the board
lacks.

**The board's own comment forbids raising the ceiling** (`auto-dispatch.ts:490-493`)
and this plan only ever lowers it: `min` cannot exceed the existing budget.
