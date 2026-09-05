# The plan format drops what nothing uses

> `DESIGN-plan.md` asks whether two declared fields are dead. Re-measured 2026-09-05 across 207 plans: `Design:` is used by **zero** and parsed in three places; `Type: docs` is used by **one**, so the point that called it dead is no longer true.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A field the plan format declares and nothing writes is either used or removed, and the four phases stop being described as the whole model.

<!-- Board impact: the board reads `plot-plan-meta.sh`'s output, so a removed
     field removes a JSON key. -->

## Motivation

**`DESIGN-plan.md` carries five open points and three are about declared-but-unused format.** Two are measurable and were re-measured 2026-09-05 across all 207 plans:

```
                     the doc says          measured today
Design: field        "used by zero plans"  0 of 207   ← still true
Type: docs           "zero of 158 plans"   1 of 204   ← no longer true
```

**`design` IS DEAD AND STILL COSTS.** Declared in the template, gated on by `/plot-implement`, parsed as `design_raw` in three places in `plot-plan-meta.sh`, and written by no plan on the estate. A field that every reader must handle and no writer produces is a branch nothing exercises.

**`docs` IS NO LONGER DEAD, AND THE POINT THAT CALLED IT DEAD IS THE FINDING.** `2026-08-30-a-machine-is-an-instance.md` uses it. The open point was measured against 158 plans; the estate is 207. **A count in a spec decays**, and this one flipped its own conclusion.

**The third point is about honesty rather than code:** CLAUDE.md describes four phases, while the honest model is four phases plus two terminal outcomes. A reader who trusts the four is surprised by the other two.

## What this is not

**Not a plan-file migration.** Nothing rewrites a plan. `design` is removed from the format or given a first user; existing plans carry neither.

**Not a change to the four phases.** Draft → Approved → Delivered → Released stays. What changes is CLAUDE.md admitting the outcomes that sit beside them.

## Slices

### `design` is used or removed (Branch: infra/a-declared-field-has-a-writer)

The `Design:` field gains a writer or leaves the format, the template, `/plot-implement`'s gate and `plot-plan-meta.sh` together.

**REMOVING IT IS THE DEFAULT AND THE SLICE MUST ARGUE OTHERWISE TO KEEP IT.** Zero of 207 is not a slow start; it is a field the format has carried without a single use. The `Design:` link this repo's recent plans do carry is written in prose under `## Design`, not in the status block — so the need it was declared for is already met another way.

**`/plot-implement` GATES ON IT, WHICH IS THE PART THAT MUST NOT BREAK.** A gate on an absent field passes vacuously today; removing the field must remove the gate rather than leave one testing nothing.

**Done when** `Design:` is either written by the template with a stated purpose or removed from all four places, and `pnpm run test:reconcile` passes.

### The type list matches the estate (Branch: infra/a-plan-type-is-in-use)

`DESIGN-plan.md`'s claim about `docs` is corrected, and the count carries its date.

**THE POINT WAS RIGHT WHEN WRITTEN AND IS WRONG NOW**, which is the whole finding: 158 plans became 207 and one of the new ones used the type. A spec number without a date is a claim that cannot be checked.

**Done when** the doc records `1 of 204` with its date and the command that produced it.

### CLAUDE.md names the outcomes (Branch: docs/the-phases-are-not-everything)

The four phases are described alongside the two terminal outcomes, so the model CLAUDE.md states is the model the parser implements.

**Done when** a reader of CLAUDE.md's phase section is not surprised by a plan that is neither Draft, Approved, Delivered nor Released.

## Notes

### Why a dead field is worth a slice — 2026-09-05

It is three parse sites, a template line and a gate — small, and each one is a place a reader must decide what an absent value means. `plot-plan-meta.sh` is called the plan-format contract in CLAUDE.md, and a contract naming a field nothing writes is a contract that cannot be read as authoritative.
