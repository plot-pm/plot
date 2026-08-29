---
'plot': patch
---

The domain's entities lose the `Fleet` prefix they never earned.

| was | is |
|---|---|
| `FleetBranch` / `FleetBranchSchema` | `SourceBranch` / `SourceBranchSchema` |
| `FleetPlan` / `FleetPlanSchema` | `Plan` / `PlanSchema` |
| `FleetSlice` / `FleetSliceSchema` | `PlanSlice` / `PlanSliceSchema` |

**The prefix was misleading, not merely redundant.** A Wave is the fleet's
cohort — cross-plan, formed at dispatch, persisted nowhere. None of these three
is that. A `PlanSlice` holds one branch and belongs to one plan; a `Plan` is the
file on disk; a `SourceBranch` is a git ref. Naming them all `Fleet*` implied a
fleet-level scope that only `Wave` actually has, in a package whose whole point
is that the design spec's terminology is binding.

`SourceBranch` rather than `Branch` because the domain also reasons about the
default branch and about refs it never checks out; `Source` says which of those
this one is — the branch work happens on.

73 occurrences across 9 files in `packages/domain` and `packages/board`, plus
13 in four `DESIGN-*.md` specs. **The names are TypeScript identifiers only** —
the wire carries `slices`/`waves`, no shell script or JSON payload mentions
them, and `pnpm build:board` produces a byte-identical artifact, so nothing
observable moved.

Shipped history keeps the old names on purpose: the CHANGELOGs, the unreleased
changesets and the Delivered plans record what those versions actually called
these types, and rewriting them would make the record wrong.
