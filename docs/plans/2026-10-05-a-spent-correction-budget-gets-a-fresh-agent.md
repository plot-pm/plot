# A spent correction budget gets a fresh agent

> Each slice gets its own correction budget, and when a slice spends it, the supervisor restarts the slice once with a fresh agent session that reads every correction and the failing run, before it asks a person.

## Status

- **State:** Approved
- **Type:** feature
- **Story:** the-supervisor-delivers-the-approved-scope
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-05, jwloka, in-session
- **Started:** 2026-10-05, jwloka, `bug/the-correction-budget-counts-per-slice`

## Changelog

- The `Correction budget` counts per slice. An agent that used its corrections on earlier slices starts each new slice with the full budget.
- When a slice spends its correction budget, the fleet supervisor starts a fresh agent session on the same desk once, with every correction and the failing run in its prompt. Only if that session's build also fails is a person asked.

<!-- Board impact: none to the plan format, the template or the docs/plans layout. The desk's ending gains one reason, `corrections-spent`, which the board reads through `EndingReasonSchema`. -->

## Motivation

Measured 2026-10-05 on this estate, with auto-dispatch on:

- **The budget is per agent, not per slice.** The loop counts corrections in the agent manifest's `correctionAttempts` (`plot-worker-loop.sh:430-445`), and nothing resets it when the agent hops to a new slice. Agent `aec50e92` spent correction 1 on `infra/the-shell-loop-holds-unlanded-work` and correction 2 on `infra/the-loop-has-a-workflow` (the actor-name gate). On its third slice, `infra/the-loop-writes-through-ports`, the first CI failure (the domain coverage gate on `0fba71b2b`) read as "the build failed after 2 corrections", and the loop stopped. That slice never got a correction.
- **A spent budget ends at a person, with nothing in between.** The loop writes `PLOT-BLOCKED: the build for <branch> failed after N corrections …`, ends with reason `unstarted`, and exits 1 (`:2911-2916`). Its exit trap removes the manifest, so the registry no longer names the desk, and `supervise` never sees it. Delivery of the slice stopped until a person read the marker.
- **Today's failures were small and mechanical**: the domain actor-name gate (a type named `WorkerFindingWrite`) and the domain coverage gate (an unreachable `never` default, then new tree adapters below their threshold). In each case the master session started a separate agent by hand with the failure text. The first two were fixed in one pass each (PR #1279); the third was in progress at writing (PR #1282).

## Design

### Approach

**Slice 1: the budget counts per slice.** The loop keys the correction count to the branch it works on. When the manifest's branch changes, the count starts at 0. The marker text, the correction file and `Correction budget` keep their meaning; only the scope of the count changes, from the agent to the slice. The change replaces the reads and raises of `correctionAttempts` with a per-branch count and adds no shell lines; `scripts/check-shell-lines.sh pr` reports no growth. Test: an agent that spent its budget on slice A starts slice B with `Correction 1 of 2` on B's first failure.

**Slice 2: the supervisor starts one fresh session.** Three parts, in the domain where they decide and in adapters where they act:

1. **The loop says why it stopped.** The spent-budget ending's reason becomes `corrections-spent` (today it is `unstarted`, which means a prompt that never started). `EndingReasonSchema` gains the value, and `endingIsAttributable` admits actor `agent` for it. The shell change replaces one word.
2. **One domain rule decides.** `freshAgentAfterCorrections(readings)` in `packages/domain/src/rules/` takes the desk's ending, its `PLOT-BLOCKED` marker, the slice's correction history (`PLOT-CORRECTION.md`), the failing run's reference, and how many fresh sessions this slice already had. It answers `start-fresh` when the ending is `corrections-spent` and the slice had no fresh session, and `needs-a-person` otherwise. The rule reads the desk, not the registry, because the manifest is gone by then — the same reason `an-unanswered-question-escalates` reads desks rather than agents.
3. **The supervisor acts through the existing continue path.** A fresh session on the same desk is what `POST /api/continue` already starts: a new worker in the branch's worktree, with the brief and an answer, from a new session (`manifest-stamp.ts` stamps `relaunches` and `previousPid`). The registry tick calls the same domain workflow with an answer it composes: every correction in order, the failing run's URL and its failed step, and one instruction: "the previous session spent its correction budget; read every failure above before you change anything, and run the checks that failed locally before you push". The marker is the loop's, not an agent's question, so this answers no question a person owes; `an-unanswered-question-escalates` keeps every agent-written question for a person.

**One fresh session per slice.** The tick records the start in `.plot/state/fresh-agents.tsv` (branch, desk, time, the failing run). A second spent budget on the same slice reads `needs-a-person`, writes a `blocked` declaration, and the escalation plan's rungs take over. A missing or unreadable record reads as "no fresh session yet", which can start one extra session but never stops delivery silently.

**What a fresh session is not.** It is not a resume: a resumed session carries the context that produced the failing commits twice. It is not a new desk: the branch is checked out in the old desk, and git refuses a second checkout. And it is not unbounded: one per slice, then a person.

**Tests.**
- Slice 1: the per-slice count, a hop resetting it, and the marker text naming the slice's own count.
- `freshAgentAfterCorrections`: `corrections-spent` with no prior fresh session gives `start-fresh`; with one gives `needs-a-person`; any other ending gives no answer; a missing record reads as none.
- The tick: a desk with a `corrections-spent` ending and no manifest produces one continue with the composed answer, and the same tick input with the start recorded produces none.
- The composed answer holds every correction in order and the failing run's URL.

### Open Questions

- [ ] Should the fresh session run on a stronger model than the slice's default, since the default already failed twice?
- [ ] Should a spent budget whose failures are all the same gate (for example coverage twice) go to a person at once, as a sign that the gate, not the code, needs a decision?

## Slices

### The correction budget counts per slice

- `bug/the-correction-budget-counts-per-slice` — the loop keys `correctionAttempts` to the branch it works on and resets it on a hop; no net shell growth <!-- builds: the per-slice correction count -->

### A spent correction budget gets a fresh agent

- `feature/a-spent-correction-budget-gets-a-fresh-agent` — the `corrections-spent` ending, `freshAgentAfterCorrections`, the registry tick's continue with a composed answer, and `.plot/state/fresh-agents.tsv` <!-- builds: freshAgentAfterCorrections -->

## Notes

- 2026-10-05, direction from jwloka: "It should actually be the fleet's supervisor's job to take care of every stop in an approved plan and fix or escalate at once." This plan is the second stop the story `the-supervisor-delivers-the-approved-scope` handles.
- The per-agent count is a defect in its own right; it is slice 1 here because the fresh-agent rule needs a per-slice count to be meaningful.
- `the-worker-loop-runs-in-js` row for a spent budget writes a `blocked` declaration and ends at a person; when that plan lands, its JS loop emits `corrections-spent` instead, and the rule above reads it the same way.
