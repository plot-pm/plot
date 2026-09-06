# A sprint knows when it ended

> A sprint's `Phase:` is written by hand and read by the release gate, and nothing keeps the two honest. Measured 2026-09-06: the one sprint in `active/` said `Planned`, and a displaced sprint still targets a release that shipped a day ago.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- A sprint whose release has shipped, or whose phase disagrees with the active index, is reported rather than left for a person to notice.

<!-- Board impact: the board renders sprint cards from the same parse; a sprint
     that reports its drift is one the card can show. -->

## Motivation

**`DESIGN-sprint.md` asks three questions and two are measurable.** Both were measured 2026-09-06.

**THE PHASE AND THE INDEX DISAGREED, ON THE ONLY LIVE SPRINT.** `docs/sprints/active/` held exactly one symlink — `the-domain-owns-the-lifecycle` — while that file's `Phase:` read **`Planned`**. Two records of *is this sprint running*, disagreeing, with the release gate reading one of them.

This repeats a defect fixed the day before: `2026-W35-the-board-tells-the-truth-in-every-section` carried `Phase: Active` while not being in the index at all. **Same field, opposite direction, four days apart.**

**A SPRINT WHOSE RELEASE SHIPPED IS CLOSED IN EVERY SENSE BUT THE FIELD.** The doc's own open point says so. Measured: `2026-W36-a-half-landed-workflow-says-so` reads `Phase: Planned`, `Release: 2.13.0` — and **2.13.0 shipped 2026-09-05**. The sprint has not been touched since 2026-08-29 and none of its eight items ever became a plan.

**THE TIMEBOX IS PARSED NOWHERE.** `start` and `end` are in every sprint file and read by nothing — grep finds no consumer. A sprint's own axis is time, and it is the one thing its card cannot show.

## What this is not

**Not a derived phase.** The doc asks *"should the state be derived rather than stated?"* and the answer here is no. A sprint is a **commitment**, and `entities/story.ts:3` gives the shape of the argument for its neighbour: a person's statement about intent cannot be observed. A sprint whose release shipped may still be open, because the team may still be working its items.

**What can be derived is the DISAGREEMENT.** Whether the phase matches the index, and whether the release it targets has shipped, are both facts. Reporting them is not deciding for the person.

**Not a sprint-file migration.** Nothing rewrites a sprint. The `Planned` on the live sprint is corrected in this plan's own commit, by hand, because it is one field on one file and a plan is not needed to fix what a plan is written about.

## Slices

### The gate names what it gates on (Branch: infra/a-delivery-gate-stops-by-name)

`/plot-deliver`'s gate stops at the blocking sections by name rather than at the literal `== 7.`.

**IT LEADS, BECAUSE THIS PLAN ADDS TWO SECTIONS AND THE MARKER IS POSITIONAL.** `plot-deliver/SKILL.md:318` and `:331` run `sed -n '/^== 7\./q;p'` — stop reading at section 7 — and the scan's own comment (`:1097`) says the number is load-bearing: *"Sections 1-6 keep their numbers, so /plot-deliver's gate marker still stops before the first non-blocking section."*

**THE MEANING IS "STOP BEFORE THE FIRST NON-BLOCKING SECTION" AND THE EXPRESSION IS A LINE NUMBER.** Those agree today by maintenance rather than by construction — the scan has been renumbered at least twice, and each time somebody had to notice.

**AND THE COUNT IS ALREADY WRONG WHERE IT IS DOCUMENTED.** `CLAUDE.md:150` says *"twelve sections"*; the scan emits **thirteen** — `rounds_drift=` joined the footer without the description following. That is the drift arriving in the place a reader trusts.

**Done when** the gate selects the blocking sections without depending on their number, `/plot-deliver` refuses and permits exactly what it does today, and CLAUDE.md's count matches the scan.

### The index and the phase agree (Branch: bug/a-sprint-phase-meets-its-index)

`plot-reconcile-scan.sh` reports a sprint whose `Phase:` disagrees with `docs/sprints/active/`.

**TWO RECORDS OF ONE FACT, AND THE SCAN ALREADY REPORTS THIS SHAPE FOR PLANS.** Section 7 counts `index_drift` — a plan whose phase and symlink disagree — and gates nothing on it, because a missing link is a browsing gap while a dangling one is a broken pointer. A sprint's index is the same shape and needs the same treatment.

**A NEW SECTION, NOT AN EXTENSION OF `sprint_drift`.** The scan mentions sprints 68 times already and counts `sprint_drift` — but that counts **plans** whose `Sprint:` disagrees with the sprint file. This is a fact about the **sprint file itself**, which nothing currently reads. Different subject, different count, and folding them would give a reader one number answering two questions.

**IT HAS HAPPENED TWICE IN FOUR DAYS, IN BOTH DIRECTIONS.** `Active` without a link, and a link without `Active`. Neither was caught by anything; both were found by a person reading the directory.

**Done when** the scan reports a sprint whose phase and index membership disagree, names both, and gates nothing.

### A shipped release closes nothing by itself (Branch: bug/a-sprint-names-a-shipped-release)

The scan reports a non-Closed sprint whose `Release:` has been tagged.

**REPORTED, NEVER CLOSED.** Closing is the team's word. What the scan can say is that the train has left: `plot-sprint-release.sh` already reads a sprint's declared target and every item's state, so the release side is a fact it holds.

**THE MEASURED CASE IS THE ONE THAT MATTERS.** `a-half-landed-workflow-says-so` targets 2.13.0, which shipped; it is `Planned`; it has not moved since 2026-08-29; and none of its eight items ever became a plan. That is a sprint the estate should be able to say something about without a person opening the file.

**Done when** the scan reports a non-Closed sprint whose declared release has shipped, and closes none of them.

### The timebox is read (Branch: feature/a-sprint-shows-its-dates)

`start` and `end` reach the board's sprint card.

**THEY ARE PARSED NOWHERE TODAY** — grep finds no consumer of either — so every sprint file carries two fields nothing has ever read. A field written by every author and read by nobody is either the card's missing axis or dead weight, and the doc asks which.

**`end` SPLITTING INTO PLANNED AND ACTUAL IS NOT THIS SLICE.** The doc raises it and notes *"one file already needs it"*; a second date is a format change and this slice reads the one that exists.

**Done when** a sprint card shows its timebox, and a sprint whose `end` has passed is visibly distinguishable from one whose has not.

## Notes

### Why the live sprint's phase is fixed here and not in a slice — 2026-09-06

It is one word in one file, and the plan that reports the class of defect should not leave its own instance standing while it waits to be approved. The slice is the gate; the edit is the repair.

### Read with the other seven drafts — 2026-09-06

The scan sections were the finding of an interrogation across all eight open plans rather than of this plan's own round. **Four drafts touch `plot-reconcile-scan.sh`**, and no per-plan round could see that two of them proposed new sections while a fifth had already been added without its documentation.
