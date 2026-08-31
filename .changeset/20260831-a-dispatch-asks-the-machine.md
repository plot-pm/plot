---
'plot': minor
---

Auto-dispatch asks the machine whether it has room, and the measurement that
answers is bounded by **time** as well as by count.

`planAutoDispatch` now reads `hasRoomToDispatch` beside the budget, through the
existing `machine-system` adapter — the second of the two questions a dispatch
asks, alongside the Asking slice's `isFree`.

**The sampling bound is the real work.** `machineSystem` looped sequentially
with no maximum and no abort, so the measurement's cost scaled with the very
thing it measured: 100 forks cost 0.48 s at 4.8 ms/fork and 28.7 s at
287 ms/fork. Measured by hand 2026-08-30 while deciding whether to dispatch —
28.7 s spent asking whether the machine was busy, spent exactly when there was
nothing to spare.

**It divides by what was actually taken, not by what it asked for.** Dividing
by `samples` after an early stop would report 287/100 = 2.87 ms — a `clear`
verdict from a starving machine, under-reported by exactly the factor that made
the stop necessary.

**A starved reading defers; it does not refuse** (`DESIGN-machine.md` §7/§10).
The message carries the number, and `Machine override` is the operator's *now
anyway*. An `unmeasured` reading dispatches: silence is never a refusal.

`dispatchDefers` is deliberately **not** the negation of `hasRoomToDispatch`.
A `tight` reading fails that predicate and defers nothing, so collapsing the two
would stop the fleet on every tight reading.

The deferral sentence's `unmeasured` arm is held by a test even though
`measureMachine` cannot reach it — it derives headroom *from* `spawnCostMs`, so
the two fields cannot disagree by that path. The sentence exists to be
answerable, and `spawn cost null ms` is the one rendering worse than silence:
it reads as a measurement rather than as its absence.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
