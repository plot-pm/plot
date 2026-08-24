---
'@plot-pm/board': patch
---

board: a one-wave plan's row carries its wave's Start work

`one-wave-renders-as-its-plan` hid the wave row for a plan that declares exactly
one wave — the plan row now carries the wave's verdict. But a wave row also
carried an ACTION: *Start work*, the wave's own control, dispatching that single
wave. Hiding the row took the control with it, so a one-wave plan's row offered
its status and no way to act on it.

## What changed

`PlanRow` now renders the wave row's `WaveActions` control (*Start work*)
alongside its own `PlanActions`, gated on the plan having a sole wave whose
verdict is `eligible`. For a one-wave plan there is nothing to guess — the old
worry that a plan-row dispatch "would have to guess which of the plan's waves it
meant" is exactly what a single-wave plan does not have. `plot-dispatch.sh` fans
out the eligible wave, which here is the only wave there is.

A MULTI-wave plan's row is unaffected: its wave rows still render and still carry
their own controls, so a plan-row control would be the guess the boundary avoids.
The plan-level acts (Approve, Commission, Deliver) are unaffected by the wave
count — the wave act rides ALONGSIDE them, never in place of them.
