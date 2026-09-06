# A dispatch action asks for its brief

> `plot-dispatch.sh` asks the `Brief command` to write a missing brief. The board's auto-dispatch and its *Start work* button do not — they filter the branch out and go quiet. Three doors onto one act, and only one of them offers the step the other two need.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- Every path that starts work offers to write the brief it requires, instead of silently declining to start.

<!-- Board impact: the Start work button and the auto-dispatch switch both gain
     a step. The board renders the asking and its outcome. -->

## Motivation

**A slice with no brief is not started.** `auto-dispatch.ts:911` states it and `findMissingBriefs` enforces it, reading `origin/main` rather than the filesystem so a lagging checkout cannot be wrong about main. That rule is right and this plan does not touch it.

**WHAT DIFFERS IS WHAT EACH DOOR DOES ABOUT IT.**

| door | brief missing → |
|---|---|
| `plot-dispatch.sh` | **asks the `Brief command`**, names the log, says to dispatch again once it lands |
| board auto-dispatch | filters the branch out (`auto-dispatch.ts:449`, `:494`), logs a skip |
| board *Start work* | the branch is not offered |

**The asking arm is built, configured and proven.** `plot-dispatch.sh:492` spawns it detached with `PLOT_PLAN_SLUG` and `PLOT_BRIEF_BRANCH`; `Brief command` is set in this repo's `## Plot Config`. The board reaches none of it.

**MEASURED 2026-09-06, AND IT COST AN AFTERNOON.** Nine eligible slices had no brief. Auto-dispatch was **on**. It skipped all nine every pulse for hours, and eight agents sat idle while the board rendered the slices as startable. A person eventually wrote the briefs by hand.

**The board's log said so** — *"skipping branch(es) with no brief on origin/main (run /plot-implement first)"* — which is a good sentence in a place nobody was reading. **A skip nobody sees is the defect `a-refused-dispatch-asks-for-a-brief` already fixed once, for the shell.**

## What this is not

**Not a weakening of the brief gate.** No slice starts without a brief. The change is what happens instead of stopping.

**Not automatic brief acceptance.** The `Brief command` writes a brief; a person still reads it. The dispatch happens on a later pulse, once the brief is on `origin/main` — which is exactly `plot-dispatch.sh`'s existing shape: *"dispatch again once it lands; the gate reads <ref>."*

**Not a promise that a brief appears.** `plot-dispatch.sh:500` is explicit that the count measures the START and not the result — measured 2026-09-02, a `Brief command` that answered `Unknown command: /plot-implement` in 33 bytes still counted. The board must inherit that honesty, not paper over it.

**Not a fourth implementation.** The arm exists in the shell. The board should reach it, not re-derive it.

## Slices

### The board asks for the brief it is missing (Branch: feature/the-board-asks-for-a-brief)

Auto-dispatch invokes the `Brief command` for a branch it would otherwise skip, and reports what it started.

**IT ASKS AT MOST ONCE PER BRANCH, NOT ONCE PER PULSE.** The board pulses every 5 s and the command is a `claude -p` session of unknown length. An unguarded ask spawns a session every pulse for every unbriefed branch — with nine branches that is a fork bomb with a friendly name. **Reuse the in-flight mark**, which already exists for dispatches the pulse cannot yet see, and retire it on the same evidence.

**IT IS BOUNDED BY THE SAME CAP AS A DISPATCH.** A brief-writing session costs what an agent costs. `parallelAgents` is the fleet's budget and asking must draw on it, or the cap stops meaning anything.

**IT REPORTS THE START, NEVER THE OUTCOME**, and names the log — the property `plot-dispatch.sh:500` had to learn by measurement.

**Done when** auto-dispatch asks for a missing brief at most once per branch, the ask is bounded by the agent cap, the board names the log, and a branch whose brief never arrives is not asked again on the next pulse.

### Start work says what it will do first (Branch: feature/start-work-offers-the-brief)

The *Start work* button is offered for a slice with no brief, and says that it will write one first.

**TODAY THE BUTTON IS SIMPLY ABSENT**, which reads as *this cannot be started* when the truth is *this needs one step first*. `PlanCard.tsx:28` records that this button has vanished from startable plans once before.

**THE LABEL MUST NOT LIE.** A button that says *Start work* and writes a brief has done something other than what it said. It says what it will do — the wording is the deliverable, and it is a person's judgement, not a mechanical one.

**Done when** a slice with no brief offers an action whose label says a brief will be written first, the action asks the `Brief command`, and no slice starts a worker without a brief on `origin/main`.

## Notes

### Why the shell already does this — 2026-09-06

`a-refused-dispatch-asks-for-a-brief` is Released and it is this plan one door earlier: a dispatch that refused for a missing brief was a dead end, and the fix was to offer the step rather than report the wall. The board grew its own dispatch path afterwards and did not inherit the offer.

**That is the shape to expect wherever a second door appears** — and the argument for reaching the shell's arm rather than writing a third one.
