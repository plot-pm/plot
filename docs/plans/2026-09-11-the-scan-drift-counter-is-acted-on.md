# The scan drift counter is acted on

> `sprint_drift` has been non-zero for weeks and nothing reads it. Measured 2026-09-11, it is also **three different facts under one number**, and one of the three is not drift at all.

## Status

- **State:** Draft
- **Type:** bug
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches

## Changelog

- The sprint-drift finding separates a member naming no plan from a plan naming the wrong sprint, so a reader can act on each instead of re-deriving the split from 57 lines.

<!-- Board impact: none yet. Whether a counter reaches the board is the open
     question this plan deliberately does not answer — see Notes. -->

## Motivation

**Filed as a W36 Should with `sprint_drift=27`. Unbuilt when that sprint closed on 2026-09-11, and the count read 57 that day** — it more than doubled while nothing consumed it.

**A counter nobody reads is not neutral.** It trains a reader to skim the footer, which is where `attention=` also lives — the one counter that gates `/plot-deliver`. A number that has been non-zero and ignorable for weeks teaches people that footer numbers are ignorable.

### What the count actually holds — measured 2026-09-11

Not one fact. Three:

| shape | count | is it drift? |
|---|---|---|
| sprint member names no plan | 18 | **no** — an unplanned item is honestly unplanned |
| plan has no `Sprint:` field | 13 | yes, and mechanically fixable |
| plan's `Sprint:` names a *different* sprint | 26 | yes, and needs a person |

**The largest share is not a defect.** W36 alone contributes 8 members with no plan, and its own note says *"Nothing here has a plan yet"* — deliberately. Counting those as drift is what makes the number both large and unactionable.

**The third shape is the one worth a person's time** and it is buried: a plan claimed by one sprint while naming another is a real disagreement about what shipped where.

## What this is not

- **Not a new gate.** `attention=` is the blocking counter and stays the only one. Everything here is advisory, below the `== blocking sections end ==` marker.
- **Not automatic repair.** The `Sprint:` field is a claim about intent; a script that backfilled it would be inventing one.
- **Not a board feature.** Whether any of this reaches the board is a separate question — see Notes.

## Slices

### Section 9 separates its three findings (Branch: bug/the-scan-drift-counter-is-acted-on)

Split the one section into three counters, each with its own heading and its own `fix:`/`inspect:` line.

**A member naming no plan stops being called drift.** It is reported — an item nobody planned is worth seeing — but under its own name and its own counter, so the two real defects are not buried under it.

**Done when:**

- The footer carries three counters in place of `sprint_drift`, and each is separately non-zero on this estate.
- A member with no plan is reported as such, never as drift.
- A plan missing `Sprint:` prints the backfill line it already prints.
- A plan naming a different sprint prints both names — it does today and must keep doing so.
- The blocking set is unchanged: all three sit below the marker and `attention=` does not move.
- Measured on this estate: 18 / 13 / 26 against today's undifferentiated 57, and the three sum to it.

## Notes

### Why "reaches a reader" is not answered here — 2026-09-11

The W36 item said the counter should *"reach a reader instead of a footer"*, which sounds like the board. **This plan deliberately stops short of that**, because the measurement says the counter is not yet worth rendering: 18 of 57 lines are not defects, and a board chip showing 57 would carry the same uselessness into a more prominent place.

**Separate first, then decide.** Once the three numbers exist and one of them is small and real, whether it earns a rendered state is a question with evidence behind it.

### The renumbering risk — 2026-09-11

`plot-reconcile-scan.sh` has been renumbered twice, and `/plot-deliver`'s gate reads to the `== blocking sections end ==` marker rather than to a section number for exactly that reason. Adding two sections below the marker is safe by construction; the plan names this so the next reader does not re-derive it.
