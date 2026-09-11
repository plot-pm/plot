# The scan drift counter is acted on

> `sprint_drift` has been non-zero for weeks and nothing reads it. Measured 2026-09-11, it is also **three different facts under one number**, and one of the three is not drift at all.

## Status

- **State:** Draft
- **Type:** bug
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

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
| sprint member names no plan | 18 | **no** — see below |
| plan has no `Sprint:` field | 18 | yes, and mechanically fixable |
| plan's `Sprint:` names a *different* sprint | 21 | yes, and needs a person |

*(18 + 18 + 21 = 57, the footer's number. An earlier draft of this plan printed 18/13/26, which was a transcription error and did not sum — corrected 2026-09-11 against the scan's own output.)*

**The largest share is not a defect, and the reason is stronger than "unplanned work exists."** The 18 split almost evenly between two sprints, and they are opposite cases:

- **W36 contributes 8.** Its own note says *"Nothing here has a plan yet"* — deliberately, and it closed that way.
- **W39 contributes 8, and every one of them SHIPPED.** `a-rejection-is-a-controller-command` (#843), `a-release-is-a-controller-command` (#848), `adoption-is-a-controller-command` (#840), `a-pr-is-opened-by-a-controller` (#846), `a-lifecycle-field-has-one-writer` (#851), `the-board-says-which-ci-answered` (#881), plus two verified complete by measurement.

**So the counter's largest component is produced by work being DONE.** A slice that merges as a PR without a plan file is a normal, frequent shape on this estate — it is how most of W39 shipped — and calling it drift means the number rises as the sprint succeeds. That is the strongest argument against rendering it anywhere a person is asked to act on.

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
- Measured on this estate: **18 / 18 / 21** against today's undifferentiated 57, and the three sum to it.

## Notes

### Why "reaches a reader" is not answered here — 2026-09-11

The W36 item said the counter should *"reach a reader instead of a footer"*, which sounds like the board. **This plan deliberately stops short of that**, because the measurement says the counter is not yet worth rendering: 18 of 57 lines are not defects, and a board chip showing 57 would carry the same uselessness into a more prominent place.

**The W39 half sharpens that into a rule.** A counter whose largest component GROWS as work ships is not a health signal, and putting it where a person is asked to act on it teaches them to dismiss the place it sits — which is the footer's existing problem moved somewhere more expensive.

**Separate first, then decide.** Once the three numbers exist and one of them is small and real, whether it earns a rendered state is a question with evidence behind it.

### The renumbering risk — 2026-09-11

`plot-reconcile-scan.sh` has been renumbered twice, and `/plot-deliver`'s gate reads to the `== blocking sections end ==` marker rather than to a section number for exactly that reason. Adding two sections below the marker is safe by construction; the plan names this so the next reader does not re-derive it.
