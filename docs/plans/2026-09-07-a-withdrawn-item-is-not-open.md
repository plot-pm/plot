# A withdrawn item is not open

> `plot-sprint-release.sh` reads a checkbox and a `delivered` flag, and never `State:`. So a plan somebody rejected is indistinguishable from one still being written, and its sprint item blocks the release forever.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #792 merged

## Changelog

- A sprint item whose plan was withdrawn reports as withdrawn, so a release is not blocked by work somebody decided not to do.

<!-- Board impact: the board renders sprint items from this script's states, so
     a fourth state is a rendering the board must handle. -->

## Motivation

**Measured 2026-09-07.** `the-board-answers-while-it-scans` carries `State: Rejected` and a `Rejected: 2026-08-31, Jan Wloka, in-session` record. Its sprint item read `open` — indistinguishable from work nobody has started.

**`item_state` (`plot-sprint-release.sh:73`) reads two inputs**, a checkbox and `delivered`, and derives three words. **Neither input can express *withdrawn***, so there is no honest box:

- **unticked** → `open`, and the item blocks the sprint forever over work somebody decided not to do
- **ticked** → `disputed`, which at least says *these two records disagree, come and look*

**IT IS TICKED TODAY, AND THAT IS A WORKAROUND.** `disputed` is the less wrong of two wrong answers, chosen because it is visible rather than silent. It also collides with a genuinely different case: `the-scripts-say-slice` reads `disputed` because it has **no plan file at all**. One item has a plan the shell will not read; the other has no plan to read. **Both surface as one word**, and a reader cannot tell them apart without opening the files.

**THE PARSER ALREADY KNOWS.** `plot-plan-meta.sh` reports `phase: rejected` for that plan today — the reading exists and this script does not ask for it. Nothing new needs parsing.

**IT IS NOT ONE ITEM.** Two sprint items point at Rejected plans (`the-board-answers-while-it-scans`, `the-board-suite-fits-its-budget`), and the estate holds **three Rejected and three Superseded** plans. Every one of them is a sprint item waiting to happen.

**THE SAME TRAP CAUGHT THE PLAN ITSELF.** It sat at `Draft` for six days after being withdrawn, on the reasoning that Plot had four phases and none was *withdrawn*. Its own correction note says what that cost: *"A withdrawn plan left in Draft sits in the approval queue forever."* The plan was fixed; the sprint reader was not.

## What this is not

**Not a fifth phase.** `plot-plan-meta.sh:338` already accepts `rejected` and `superseded` beside the four. This is a consumer catching up with a vocabulary that exists.

**Not a rename of the three existing states.** `done`, `open` and `disputed` keep their meanings and their asymmetry — the long comment above `item_state` argues that asymmetry carefully and it stands.

**Not a release-gate loosening.** A withdrawn Must Have must still be *visible* to a release cutter. What changes is that it reports as a decision rather than as unstarted work.

## Slices

### The sprint reader knows a withdrawn plan (Branch: bug/a-withdrawn-item-is-not-open) <!-- waits: bug/a-sprint-item-has-one-scorer -->

`item_state` learns a fourth answer for a plan whose `State:` is terminal-but-not-delivered.

**THE READING COMES FROM `plot-plan-meta.sh`**, which already reports `phase: rejected`. Add the phase to what the caller passes `item_state`; do not re-parse the plan file.

**`rejected` AND `superseded` ARE ONE ANSWER HERE.** Both mean *this plan will not deliver, and somebody decided that*. They differ in why, which the plan's own record says; the sprint's question is only whether the item is still owed.

**IT DOES NOT BLOCK, AND IT IS NOT `done`.** A withdrawn Must Have must not stop a release — that is the defect. It must also not read as completed, because nothing shipped. The word says withdrawn.

**THE CHECKBOX STOPS MATTERING FOR THESE.** Ticked or unticked, a withdrawn plan is withdrawn; the estate outranks the box here exactly as it does for `delivered`. Say so where the existing asymmetry is argued, so the next reader finds one rule and not two.

**`/plot-sprint close` AND THE RELEASE GATE MUST AGREE.** The existing comment records why: if the release gate were the lenient one, two commands would disagree about one line, *"and that is the wrong way round."* Whatever `close` does with a withdrawn item, the release gate does the same.

**IT WAITS FOR THE SINGLE SCORER, AND THE ANNOTATION SAYS SO.** [`a-sprint-item-has-one-scorer`](2026-09-07-a-sprint-item-has-one-scorer.md) found that `scoreItem` has no production caller and the live rule is 12 lines of bash — so against today's shape this is FOUR edits with nothing to catch a missed one. After that plan lands it is one function and one enum, with a corpus test that fails if the shell disagrees.

**IT IS A CONTRACT CHANGE, AND THREE CONSUMERS ARE PINNED TO THREE STATES.** Round 1 found them: `entities/sprint.ts:37` declares `ItemStatusSchema = z.enum(['done', 'open', 'disputed'])`; `workflows/release.ts:172` branches on `disputed` to word its message; `/plot-release` step 3 refuses on `open` or `disputed`. **Widen the enum rather than working around it** — a Zod enum fails loudly on a value it does not know, which is the direction that finds the fourth consumer if there is one. The board's `app/` renders none of these, so the UI is not a consumer.

**THE RELEASE REPORTS A WITHDRAWN ITEM AND DOES NOT BLOCK ON IT.** Naming it is the point: a cutter reading the release output sees that something was dropped from this sprint and by whom. Filtering it out silently would lose that, and blocking would keep the defect under a new name.

**AND THE SECOND RECORD GOES.** `/plot-sprint`'s contract documents a `<!-- status: ... -->` annotation per sprint line, written by `/plot-approve`, `/plot-deliver` and `/plot-reject`, whose documented values already include `rejected`. Measured 2026-09-07: **35 lines across four sprints carry one, `plot-sprint-release.sh` reads it nowhere, and ZERO say `rejected`** — so the writer never writes the value and the reader never reads the field. **Delete the annotation from the contract and from the lines that carry it.** The plan file is the source of truth: it carries `State:` and a dated `Rejected:` record, and the estate-outranks-the-checkbox rule this script already argues points the same way. A cache nobody refreshes and nobody reads is a second answer waiting to contradict the first.

**Done when** a sprint item whose plan is `Rejected` or `Superseded` reports as withdrawn rather than `open` or `disputed`, `ItemStatusSchema` admits the fourth value and `release.ts` handles it, `/plot-release` names a withdrawn item and does not block on it, the checkbox does not change that answer, `/plot-sprint close` and the release gate agree, the `status:` annotation is gone from the contract and from the 35 lines carrying it, and the two items measured here read correctly.

## Notes

### Why `disputed` is the wrong home for this — 2026-09-07

`disputed` means *these two records disagree*, and it is doing real work: a checked box over an undelivered plan is somebody claiming completion the estate denies.

A withdrawn item is not a disagreement. The box and the plan agree completely — the work is not going to happen. Filing it under `disputed` sends a reader to look for a conflict that is not there, and it dilutes a word that currently means something precise.

**Two items reading `disputed` for opposite reasons is the measurement**: one has a plan the shell will not read, the other has no plan at all. A state that covers both covers neither.

### Round 1 — 2026-09-07

**The plan said "a fourth answer" and did not say what that costs.** Three consumers are pinned to the three states — a Zod enum in the domain, a workflow that branches on `disputed`, and a skill that refuses on it. Widening the enum was chosen over the two alternatives (filtering the item out before the tiers; making it `done` with a reason) because a withdrawal is a fact worth reporting, and `done` risks a release cutter reading *shipped*.

**And the round found a second record of the same fact, which the plan had not seen.** `/plot-sprint`'s documented `<!-- status: ... -->` annotation already admits `rejected`. It is dead in both directions: 35 lines carry the annotation, none carries that value, and the release script reads the field nowhere. That is not a smaller version of this defect — it is the same defect a second time, and leaving it would mean fixing one of two answers to one question.
