# The pulse's tracer flag means one thing

> The pulse's `tracer` flag is computed from `<!-- spike -->` markers while its schema documents `Tracer: yes`; one meaning is chosen and the schema, the walk and the parser state it.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3102
- **Review:** pr
- **Impl:** own branches

## Changelog

- The pulse's `tracer` flag has one documented meaning, and the plan walk, the schema and the plan parser agree on it.

<!-- Board impact: none to the plan format. The `tracer` field on the pulse plan row keeps its name and type; only the rule that sets it can change. -->

## Motivation

The `tracer` flag on a pulse plan row has two meanings, and each reader sees a different one.

- `FleetReadingSchema` documents it as "Whether the plan's `## Status` says `Tracer: yes`" (`packages/domain/src/entities/fleet.ts:713-720`).
- `assemblePlanWalk` sets `tracer: planSpikes > 0` (`packages/domain/src/workflows/plan-walk-assembly.ts:391`), where `planSpikes` counts `<!-- spike -->` markers on branch lines (`:337-338`). `planRow` writes the value to the pulse row (`:552`). Commit `45ae8a839` introduced this.
- `plot-plan-meta.sh` still emits `"tracer":true` for a `Tracer: yes` line (`skills/plot/scripts/plot-plan-meta.sh:806`, read at `:1284`). `PlanRecord` (`packages/domain/src/ports/plan-store.ts`) has no tracer field, so the walk never reads that key.
- `planAutoDeliver` skips a tracer plan until a dependent plan delivers (`packages/domain/src/rules/auto-deliver.ts:293-294`). It leaves a tracer plan with no dependent to a person (`:281`).

Effect on `origin/main` at `1fa36d2aa`:

- A plan with a `<!-- spike -->` marker and no `Tracer:` line reads as a tracer plan, and auto-delivery holds it for a person.
- A plan with `Tracer: yes` and no marker does not read as a tracer plan, and auto-delivery delivers it.

The safety juror of the panel on plan PR #3095 found this (`.plot/panels/2026-11-03-registry-never-hands-out-an-approved/safety.md`).

## Design

### Approach

A person decides which meaning the pulse carries. After that decision, the schema doc, the walk and the parser state the same meaning, and one test per reader holds it.

**Option A — `Tracer: yes` (recommended).** The plan `2026-10-12-design-work-proves-the-path` defines a tracer plan by that line (D15) and keeps it apart from the spike marker on purpose: the marker lets one slice run before approval, the line says the plan waits for a dependent. Under this option:

- `PlanRecord` gains a `tracer` field, set from the parser's existing `tracer` key.
- `assemblePlanWalk` sets `tracer` from that field and no longer from `planSpikes`. The spike readings (`spikeAt`, `spikeApproved`) keep their own source.
- The schema doc and the parser stay as written.

**Option B — any spike marker.** The flag then means "the plan names a spike". Under this option:

- The schema doc for `tracer` states the marker rule.
- The parser's `tracer` key and the `Tracer: yes` line have no reader and are removed, or kept and documented as unused.
- `FleetReadingSchema`'s comment on `PlanSlice` and the `auto-deliver.ts` comments say "spike", not "tracer".
- Plans written with `Tracer: yes` under D15 change meaning, so the decision needs a migration check over `docs/plans/`.

Whichever option is chosen, a corpus or unit test feeds one plan with a marker and no `Tracer:` line, and one plan with `Tracer: yes` and no marker, through the plan walk. Each test asserts the flag the chosen option gives. `planAutoDeliver` gets a test for the same two plans.

Design decisions pass the MANIFESTO 9-question checklist; neither option adds configuration or a project-specific name.

### Open Questions

- [ ] Does the pulse's `tracer` flag mean `Tracer: yes` (Option A) or any `<!-- spike -->` marker (Option B)?
- [ ] Option B only: do any plans on `main` say `Tracer: yes`, and what happens to their delivery?

## Slices

### Tracer flag

- `feature/the-pulse-s-tracer-flag-means` — the plan walk, the schema doc and the parser state the chosen meaning of `tracer`, with the two-plan test

## Notes

- Source: issue #3102. The plan stops at Draft; the choice between the two options is the reviewer's.
