---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

The domain names a Slice a Slice.

`FleetWaveSchema` → `FleetSliceSchema`, `WaveVerdictSchema` →
`SliceVerdictSchema`, and `FleetPlanSchema.waves` → `.slices`, inside
`@plot-pm/domain`.

**The name was occupied by the wrong tenant.** `DESIGN-slice.md` settled the
vocabulary on 2026-08-28, and by every property the object in code is a Slice:
it holds `branches[]` and belongs to exactly one plan. A **Wave** is the fleet's
cohort — slices drawn from several plans, sized by the agents available,
assembled at dispatch and persisted nowhere. That entity does not exist in code
yet, and building it was awkward while its name was taken. The domain now
reserves it, in a comment that says what it will hold.

**The wire accepts both spellings.** `plot-fleet-scan.sh` is a separate process
that ships separately and still emits `"waves"` — the version skew this repo
already got wrong across v2.5.0–v2.11.0. So the schema reads `slices` when
present and falls back to `waves`, normalizing to `slices`. A new board works
against an old scan. The producer emitting the new name is step 2 of the
migration and has its own timing decision; the scan is deliberately untouched
here.

**The board keeps compiling, unedited.** Old names remain as re-exports
(`SliceVerdictSchema as WaveVerdictSchema`, `FleetSliceSchema as
FleetWaveSchema`), and the parsed plan carries `waves` as a deprecated alias of
the same array. Both are a bridge with an end date: the branch that moves the
board's 44 call sites removes them, and `tsc` is what will name any site left
behind. Without the alias the rename breaks 37 call sites across 6 server files
— a diff this change is specified not to make, so that the schema change and the
call-site churn can be reviewed as distinct claims.

`FleetPulseSchema` stays a plain `z.object`, because the board reads
`FleetPulseSchema.shape.summary` and a preprocessed schema exposes no `.shape`.
`summary.waves` likewise keeps its wire name: the summary is a tally the board
BUILDS as well as parses, so its counter moves with those producers.

**What proves it:** a pulse in either spelling parses to the same object,
asserted on both inputs rather than on one plus a claim about the other. The
domain's 100% coverage gate holds over the package's first real branches — nine
of them, including both arms of the fallback and the non-object guard. The
vocabulary gate drops from 34 occurrences to 14, every survivor either the
comment reserving the name or the compatibility path itself.
