---
---

<!--
bumps:
  board: patch
-->

# One-wave plan renders as its plan

A plan with exactly one wave now renders that wave's status on the **plan row**
rather than nesting a separate wave row beneath it. The wave adds no information
beyond what the plan itself says — it has the same name, the same branches, the
same verdict — so the second row costs vertical space without earning it.

## What changed

1. **Schema**: Added `planWaveCount` to the `Wave` type — how many waves the
   plan declares, defaulted so pulses from older servers still validate.

2. **Server** (`fleet.ts`): Populates `planWaveCount` on each derived wave,
   reading it from the scan's plan data.

3. **Client** (`AgentList.tsx`):
   - Added `isOneWavePlan(wave)` helper — returns `true` when `planWaveCount === 1`.
   - Added `soleWaveFor(planName, waves)` — finds the sole wave for a plan.
   - `PlanRow` now accepts a `soleWave` prop and renders its verdict in slot 5.
   - Wave row rendering is **skipped** for one-wave plans; the branches render
     directly beneath the plan row.

## Measurement

On this estate, 35 of 54 plans have exactly one wave. Every plan that shipped
before the multi-wave convention (2026-03-15) is one-wave by construction, and
19 of the 35 are that vintage. The other 16 are genuinely small plans whose
scope never needed slicing.

## Backward compatibility

The `planWaveCount` field **defaults to 2** in the schema, so a pulse from a
server predating this field still validates and is treated as multi-wave (wave
rows shown). This is the conservative reading: absent information means *show
everything*, never *hide something*.
