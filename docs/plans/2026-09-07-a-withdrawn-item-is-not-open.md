# A withdrawn item is not open

> `plot-sprint-release.sh` reads a checkbox and a `delivered` flag, and never `State:`. So a plan somebody rejected is indistinguishable from one still being written, and its sprint item blocks the release forever.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

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

**Not a change to the three existing states.** `done`, `open` and `disputed` keep their meanings and their asymmetry — the long comment above `item_state` argues that asymmetry carefully and it stands.

**Not a release-gate loosening.** A withdrawn Must Have must still be *visible* to a release cutter. What changes is that it reports as a decision rather than as unstarted work.

## Slices

### The sprint reader knows a withdrawn plan (Branch: bug/a-withdrawn-item-is-not-open)

`item_state` learns a fourth answer for a plan whose `State:` is terminal-but-not-delivered.

**THE READING COMES FROM `plot-plan-meta.sh`**, which already reports `phase: rejected`. Add the phase to what the caller passes `item_state`; do not re-parse the plan file.

**`rejected` AND `superseded` ARE ONE ANSWER HERE.** Both mean *this plan will not deliver, and somebody decided that*. They differ in why, which the plan's own record says; the sprint's question is only whether the item is still owed.

**IT DOES NOT BLOCK, AND IT IS NOT `done`.** A withdrawn Must Have must not stop a release — that is the defect. It must also not read as completed, because nothing shipped. The word says withdrawn.

**THE CHECKBOX STOPS MATTERING FOR THESE.** Ticked or unticked, a withdrawn plan is withdrawn; the estate outranks the box here exactly as it does for `delivered`. Say so where the existing asymmetry is argued, so the next reader finds one rule and not two.

**`/plot-sprint close` AND THE RELEASE GATE MUST AGREE.** The existing comment records why: if the release gate were the lenient one, two commands would disagree about one line, *"and that is the wrong way round."* Whatever `close` does with a withdrawn item, the release gate does the same.

**Done when** a sprint item whose plan is `Rejected` or `Superseded` reports as withdrawn rather than `open` or `disputed`, a withdrawn Must Have does not block a release, the checkbox does not change that answer, `/plot-sprint close` and the release gate agree, and the two items measured here read correctly.

## Notes

### Why `disputed` is the wrong home for this — 2026-09-07

`disputed` means *these two records disagree*, and it is doing real work: a checked box over an undelivered plan is somebody claiming completion the estate denies.

A withdrawn item is not a disagreement. The box and the plan agree completely — the work is not going to happen. Filing it under `disputed` sends a reader to look for a conflict that is not there, and it dilutes a word that currently means something precise.

**Two items reading `disputed` for opposite reasons is the measurement**: one has a plan the shell will not read, the other has no plan at all. A state that covers both covers neither.
