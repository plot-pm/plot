# The tight band remembers what it started

> A machine reading says whether one more process is affordable now, and never whether the last twenty were — so a board parked just under the refusal line dispatches indefinitely.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The auto-dispatch loop stops adding agents while the machine sits in the `tight` band. A reading answers whether one more fork is affordable and carries no memory of what it already started, so a board just under the refusal threshold dispatched every pass.

<!-- Board impact: this IS a board change — the auto-dispatch loop's decision.
     No plan format, no template, no layout. -->

## Design

**Measured 2026-09-15 on this machine**, from `.plot/logs/board.log` during a
live incident: **84 plot processes, ~24 GB of compressed memory, `/api/board` at
10.7 s.** Every reading below is from that log or from the code on the path.

### The gate is not broken, and an earlier draft of this plan said it was

**`dispatching anyway` is the designed behaviour of the middle band.** There are
three: `clear`, `tight`, `starved` (`machine.ts:57-58`, thresholds
`{clearBelowMs: 10, starvedAboveMs: 50}`). `dispatchDefers` is deliberately
**not** the negation of `hasRoomToDispatch`, and `machine.ts:106-110` says why:

> *"That function answers *is the machine clear?*, which `tight` fails; this
> answers *should a dispatch wait?*, which only `starved` passes."*

And the line that prints is documented as a **reading**, not an override
(`auto-dispatch.ts:1055-1058`): *"a fleet that feels slow while nothing refuses
is the case an operator otherwise has no reading for."*

**So the 63 `dispatching anyway` lines are the `tight` band working, and the 39
`not yet` lines are `starved` correctly refusing.** Every predicate fired
exactly as specified. **This plan does not change any threshold and does not
make `tight` refuse.**

### The defect is that a reading has no memory

**All 63 tight readings measured 41.0–50.0 ms.** Min 41.0, median 46.4, max
50.0 — **every one at or above 40, and not one above the 50 ms line.** The
machine spent the entire incident parked in the top of the `tight` band.

**And that is affordable, one at a time, forever.** `Machine` carries
`spawnCostMs`, `sampleMs`, `measuredAt`, `headroom` — and **nothing about what is
already running**. The entity's own docstring calls it *"the only state that
decays instantly"*, which is right: a reading answers *is one more fork
affordable now?*

**Nobody asks the second question.** Each pass reads `tight`, dispatches one
more, and the next pass reads `tight` again — because one fork at 46 ms is
genuinely affordable, and the twenty already running are invisible to the
reading. The band has no ratchet, so a machine that never reaches `starved`
never stops.

### Why the existing cap did not hold it

`controls.parallelAgents` is checked (`auto-dispatch.ts:1069`) and is a real
bound on **agents**. It bounded nothing here because the processes were not all
agents: measured, **two agents produced twelve processes** — a loop wrapper, a
monitor and a `claude -p` each — and the incident's 84 included desks spawned by
a second caller the board cannot see.

**So the cap counts the wrong noun for this failure.** It bounds how many slices
run; the machine is spent by processes.

### The rule: a tight band dispatches, but not repeatedly

**A `tight` reading permits a dispatch and forbids the NEXT one until the machine
is measured `clear` again.** One fork at 46 ms is affordable; twenty are not,
and the difference is only visible across passes.

**This is a ratchet rather than a threshold**, and that is deliberate: changing
`starvedAboveMs` would refuse dispatches that are genuinely affordable, which is
the trade `machine.ts:106-110` already argued against. The band keeps its
meaning; what changes is that it cannot be *re-entered* without a clear reading
in between.

**`clear` resets it. `starved` already refuses.** So the new state is one bit
beside the existing controls, and the `clear` path is untouched — a healthy
machine dispatches exactly as it does today.

### What this does not do

**It does not change a threshold.** `{clearBelowMs: 10, starvedAboveMs: 50}`
stay. A plan that moved them would be tuning a number nobody measured against a
second machine.

**It does not make `tight` refuse.** The first dispatch in a tight band still
happens, because it is affordable and the band exists to say so.

**It does not touch the supervisor's own dispatching.** `plot-registryd` decides
separately, and a second caller of one decision is a real finding with its own
plan — see Notes.

**It does not count processes.** A per-process cap is a different rule needing a
different reading; this one uses the reading that already exists.

## Open Questions

- [ ] **Does the supervisor need the same ratchet?** It dispatches through its
  own path and would re-enter the tight band independently. **Does not block**:
  this plan fixes the caller that produced the measured incident, and a shared
  ratchet is the follow-up.

## Slices

### The tight band remembers what it started (Branch: bug/the-tight-band-remembers-what-it-started)

- `bug/the-tight-band-remembers-what-it-started` — let a `tight` reading permit one dispatch and refuse the next until a `clear` reading intervenes, leaving every threshold and the `clear` path byte-identical

**Done when** a run of consecutive `tight` readings dispatches **once**, pinned
by a test feeding the measured sequence — 41.0, 46.4, 50.0 ms — and asserting one
dispatch rather than three; a `clear` reading between two `tight` ones permits a
second dispatch, pinned separately, since a ratchet that never resets is a
refusal wearing another name; a machine reading `clear` throughout produces
behaviour **byte-identical** to today's, pinned by a test; `starved` still
refuses through `dispatchDefers` with its message unchanged;
`HEADROOM_THRESHOLDS` is unchanged, asserted literally; the `tight` line is still
printed on the permitted dispatch, because the operator's reading is what
`auto-dispatch.ts:1055-1058` exists for; and `pnpm run test:contracts` and the
board suite pass.

## Notes

**The incident this came from is in `.plot/logs/board.log`**, 2026-09-15: the
board dispatched continuously with `{"autoDispatch":true,"parallelAgents":5}` set
through its own controls, overriding the code defaults of `false` and `3`.
Stopping the board ended a tree of **42 processes**.

**Turning auto-dispatch off avoided this and did not fix it.** The ratchet is
what makes the band safe when somebody turns it back on.

**A second caller exists and is deliberately out of scope.** `plot-registryd`
dispatches through its own path, so during the incident three spawners — board,
supervisor, operator — each honoured a cap none of the others could see. That is
its own plan, and it is the more interesting one.

**An earlier draft of this plan blamed the gate**, reading the 63
`dispatching anyway` lines as overrides of a refusal. They are not: the band is
documented, the predicates are deliberate, and `machine.ts:106-110` argues the
exact distinction. **Caught by reading the code before writing the plan**, which
is the fourth premise on this estate in one week that a single reading disproved.
