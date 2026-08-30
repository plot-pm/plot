# Implementation brief — the-registry-owns-what-it-started (Asking the machine)

- **Plan (canonical):** `docs/plans/2026-08-30-the-registry-owns-what-it-started.md` on main
- **Branch:** `feature/a-dispatch-asks-the-machine` (base: `main`)
- **Ends as:** one PR to main
- **Independent of the other two slices**, and the sibling of `Asking`: a
  dispatch asks two things, *is an agent free* and *has the machine room*.

### What to build

`planAutoDispatch` asks `hasRoomToDispatch` before starting, through the
existing `machine-system` adapter. **Everything you need already exists and has
zero callers:**

```
entities/machine.ts   headroomFor, measureMachine, hasRoomToDispatch,
                      HEADROOM_THRESHOLDS (clear < 10 ms, starved > 50 ms)
ports/machine.ts      MachineReading — the reading, never the verdict
adapters/machine/     machine-system.ts, timing real forks with git rev-parse
test/machine.test.ts  beside it
```

**Where it goes is decided:** `auto-dispatch.ts:229` computes
`budget = parallelAgents - (liveCount + inFlight.size)`. The machine question
sits beside that, in the same function.

### The real work is the sampling bound, not the wiring

**`machineSystem` loops sequentially with no maximum and no abort:**

```ts
for (let taken = 0; taken < samples; taken += 1) {
  const run = await runProcess('git', PROBE, { cwd: context.repoRoot });
```

So the measurement's cost scales with the thing it measures:

```
                clear (4.8 ms)   tight (21 ms)   starved (287 ms)
samples=5           0.02 s          0.10 s           1.44 s
samples=100         0.48 s          2.10 s          28.70 s
```

`DESIGN-machine.md` prices the observer at **374 ms for 100 spawns** and calls a
reading per pulse affordable — **that figure was taken on a clear machine.** On
a starved one the same call is 77x more expensive, spent exactly when there is
nothing to spare. That is the story's own complaint reproduced by its fix.

**Bound it by TIME, not by count.** Sample until `samples` readings are taken
**or** a millisecond budget is spent, and report what was actually taken. A
reading from three forks is still a reading, and `sampleMs` already exists to
say what it cost.

**This was measured by hand on 2026-08-30**, deciding whether to dispatch: 100
forks at 287 ms — **28.7 s spent asking whether the machine was busy.**

### The rules that come from the spec, not from preference

**Load average is never the verdict.** `headroomFor`'s own docstring carries the
measurement: *five workers ran fine at load 10 and starved the machine at load
8, because the variable was what else was spawning.* Confirmed again on
2026-08-30 — load read 13.0 while spawn cost went 23.3 → 76.5 → 4.8 ms.

**A starved reading DEFERS; it does not refuse.** `DESIGN-machine.md` §7 and §10
were revised for this on 2026-08-30: the three forbidden actions each take
something from the operator permanently, and *"not yet"* takes nothing away. The
deferral must be **overridable**.

**The message must carry the number.** *"not yet: spawn cost 287 ms against a
clear reading of 4.8 ms"* is answerable; *"too much load"* is not.

**Silence is never a refusal.** `measuredAt` is required; a reading nobody can
date is `unmeasured`, and **`unmeasured` dispatches**.

### Done when

The plan's list. Two carry the slice:

- **the sampling is time-bounded**, asserted against a **stubbed slow process
  port** — a measurement over a 287 ms/fork machine must return within its
  budget rather than after `samples x 287 ms`. A real starved machine cannot be
  conjured in a test; the port is the seam that makes it testable.
- **a regression test holds `headroomFor` to ignoring load average**: a high
  load average with a low spawn cost must still read `clear`. That is the
  failure this repo has already measured twice.

Plus: `pnpm test:board`, `pnpm run typecheck`, artifact rebuilt, changeset.

### Scope guard

The machine question and the bound. Not `isFree` (its own slice), not the
manifest, not the thresholds — `clear < 10 ms` and `starved > 50 ms` are
settled, and changing them is a separate argument with its own measurements.
