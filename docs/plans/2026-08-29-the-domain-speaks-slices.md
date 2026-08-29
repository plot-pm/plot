# The domain speaks slices

## Status

- **Phase:** Approved
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-29, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, branch -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Approval

- **Assignee:** Jan Wloka

## Changelog

Plot's code calls a slice a slice. The entity that holds one branch and belongs
to one plan is named `Slice` everywhere it is defined, and `Wave` is freed for
the entity it actually names — the cohort the fleet lands together.

## Motivation

### One word, two entities, and the code kept the wrong one

`DESIGN-slice.md` renamed this entity on **2026-08-28**, after measuring 158
plans and 303 sections. The code has not followed. Measured 2026-08-29 in
`packages/domain/src/entities/fleet.ts`:

| | `FleetWaveSchema` as built | spec's **Slice** | spec's **Wave** |
|---|---|---|---|
| holds | `branches[]` | exactly one branch | many slices |
| belongs to | one plan (`plan.waves[]`) | one plan | **no plan** |
| persisted | in the pulse | in the plan file | **nowhere** |
| sized by | the plan's author | the work | **the agents available** |

**By every property, the object in code is a Slice.** `WaveVerdict`
(`complete`/`eligible`/`blocked`/`unapproved`) is likewise the slice's derived
state, not a cohort's.

**And the real Wave does not exist in code at all.** `DESIGN-slice.md` §1 is
explicit: *"A slice is authored by a person and lives in a plan file; a wave is
assembled by the fleet at the moment of dispatch and has no persisted form at
all."* `plot-dispatch.sh:199` requires a plan slug and computes ordering within
one plan, so nothing forms a cross-plan cohort today. **The name is occupied by
the wrong tenant**, which is what makes building the real one awkward.

### Why it was not fixed where it was found

`the-domain-moves-out-of-the-board` required a move verifiable **byte-for-byte**
— the property that lets a reviewer confirm nothing changed while 547 lines
crossed a package boundary. Renaming inside that move forfeits exactly that.
The contradiction is instead documented at the schema (PR #509), so the next
reader finds an argument rather than a puzzle.

### The size, measured — and the part that turned out to be free

```
occurrences of "wave" in code       6,277   across 195 files
board call sites reading .waves        44
plan files with a `## Waves` heading  132
plan files still on `## Branches`      30
```

**The 132 plan files need no migration, and that is the finding that shrinks
this plan.** `plot-plan-meta.sh` already parses **two** spellings — `## Branches`
(the old one, still used by 30 live plans) and `## Waves` — from one place
(`:516`, *"both spellings are covered from one place"*). Accepting a third is
what this parser already does.

**Plan files are historical records.** A delivered plan describes what was
built, under the vocabulary of its day. Rewriting 132 of them would edit the
past to match the present, and would churn every plan's git blame for a word.

## Design

### The wire field is the hard part, and it is a process boundary

`plot-fleet-scan.sh:3445` **produces** `"waves"` in its JSON; the board
**consumes** `plan.waves` at 44 sites. Shell and Node are separate processes
that ship separately — a board can be published from npm while the scan comes
from a checkout (this is exactly what v2.5.0–v2.11.0 got wrong). **So the two
cannot be renamed in one commit.**

The migration is the standard three-step, and each step is independently
shippable:

1. **The consumer reads both.** `FleetPlanSchema` gains `slices`, keeps `waves`,
   and resolves to whichever is present. A new board reads an old scan.
2. **The producer emits the new name.** The scan writes `"slices"`. Both a new
   and an old board keep working — the old one because step 1 shipped first.
3. **The old name is dropped**, one release later, once no supported scan emits
   it.

**Steps 2 and 3 are deliberately not in this plan.** Step 1 is what unblocks the
domain; the rest is a version-skew question that wants its own timing decision
and its own release note.

### The domain is renamed outright; the board gets aliases

Inside `@plot-pm/domain` there is no compatibility question — it is a new
package with one consumer. `FleetWaveSchema` → `FleetSliceSchema`,
`WaveVerdict` → `SliceVerdict`, and the board re-exports the old names so its
44 call sites keep compiling:

```ts
export { FleetSliceSchema as FleetWaveSchema, type FleetSlice as FleetWave };
```

**The aliases are a bridge with an end date**, not a permanent second
vocabulary. They exist so this plan does not have to touch 44 call sites in the
same breath as a schema change, and the branch that removes them is named below.

### Not chosen: rename everything at once

It is one commit and it is honest. Rejected because it fuses a **package-internal
rename** (no risk), a **wire-format change** (version skew across two processes),
and **44 call-site edits** (large diff, easy to hide a mistake in) into a single
change nobody can review as separate claims. The measured failure this repo
already has — a published board that could not spawn for nine releases — came
from exactly this shape: a change correct in itself, in a diff nobody could see
the whole of.

### Not chosen: leave it and rename only in prose

The spec would then describe an estate the code contradicts, which is the
condition that produced this plan. `DESIGN-review-workflows.md` §5 names the
rule: a copy that **re-implements a decision** may not stand. Two names for one
entity is that copy, in the vocabulary rather than the logic.

## Waves

### Reading (Branch: infra/the-domain-names-a-slice)

`@plot-pm/domain` renames `FleetWaveSchema` → `FleetSliceSchema` and
`WaveVerdictSchema` → `SliceVerdictSchema`, with `FleetPlanSchema.slices`
carrying the array. The board re-exports both old names as aliases, so no board
call site changes in this branch. The schema accepts **either** `slices` or
`waves` on the wire and normalizes to `slices`.

Tests: a pulse carrying `waves` parses; a pulse carrying `slices` parses; both
produce the identical parsed object; the domain's coverage gate stays at 100%.

### Speaking (Branch: infra/the-board-reads-a-slice)

The board's 44 call sites move from `plan.waves` to `plan.slices`, and the
aliases are removed. Purely mechanical, and gated by `tsc` — the compiler names
every site that has not moved.

Tests: no alias remains (`grep` for the old names returns nothing outside the
compatibility shim's own test); the board suite passes with **no test edited**
beyond the renames themselves.

### Parsing (Branch: infra/a-plan-may-say-slices)

`plot-plan-meta.sh` accepts `## Slices` alongside `## Waves` and `## Branches`,
from the same place the other two are handled. New plans may use the new
spelling; **no existing plan file is rewritten.**

Tests: a plan with `## Slices` parses identically to the same plan with
`## Waves`; the 132 existing plans still parse; `plot-reconcile-scan.sh` reports
the same counts before and after.

## Done when

1. **`@plot-pm/domain` contains no identifier named `Wave`** — except in the
   comment explaining what a Wave will be when it is built.
2. **A pulse in either spelling parses to the same object.** Asserted on both
   inputs, not on one plus a claim about the other.
3. **The 132 existing plan files parse unchanged**, with the same wave/slice
   counts as before. Asserted by running the reconcile scan and diffing its
   footer against a pre-change run.
4. **No board call site reads `waves` after the Speaking branch**, and the
   aliases are gone. `tsc` is the gate; a grep is the receipt.
5. **The scan still emits `waves`.** Step 2 of the migration is deliberately out
   of scope, and a branch that changes the emitter has widened it.
6. **The name `Wave` is left free and documented as free** — a comment in the
   domain says what the entity will hold when the fleet learns to form cohorts,
   so the next reader does not re-occupy it.
7. `pnpm test`, `pnpm run test:board`, `pnpm run test:reconcile` green.

## Notes

Raised by the operator on 2026-08-29, reading the freshly-moved domain package:
*"The initial domain model differs from the design spec. E.g we use Slice not
Wave?"*

The observation is correct and the divergence was already there — the move
carried it across faithfully rather than introducing it. What the move did do is
make it **visible**, by putting the entity graph in a package whose whole
purpose is to be the one place these names are defined.
