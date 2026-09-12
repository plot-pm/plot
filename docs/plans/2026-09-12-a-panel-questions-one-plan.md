# A panel questions one plan

> The mechanism several lenses share: one prompt, N personas in parallel, one verdict file each, a gate that forces a position, and a moderator that reconciles.

## Status

- **State:** Approved
- **Type:** feature
- **Story:** an-agent-is-declared-and-corrected
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-12, jwloka, in-session
- **Started:** 2026-09-12, jwloka, `feature/a-panel-questions-one-plan`

## Changelog

- A reusable panel: N agents read one subject through different lenses, each writing a verdict file that must carry a committed position, reconciled by a moderator.

<!-- Board impact: none in this slice — the panel writes files and the callers
     in the next slice decide what to do with them. -->

## Motivation

**Two reviews in Plot want the same mechanism and neither has it.**

`/challenge-the-plan` questions a Draft plan **sequentially**, four questions per round, and states that comprehensive coverage takes five to ten rounds. Measured 2026-09-12: 262 plans, **71** carrying a `Rounds:` field — 27%, and 33 of those 71 stopped at one round. That is a cost measurement rather than a judgement about value.

`/plot-deliver` step 5 already fans out — one subagent per merged PR, in parallel, adversarially briefed to *refute*. It varies the **PR**. It does not vary the lens, so four agents ask one question of four diffs rather than four questions of one plan.

**Both state their commitment rule in prose.** Step 5: *"A deliverable that names a behaviour is only SUPPORTED when someone ran it. 'The diff appears to add it' is a reading."* That is a rule an agent can satisfy by asserting it did. A file that must contain the evidence is a gate.

## Design

### Approach

Four parts, and the value is that all four are shared:

1. **Fan-out** — N agents, **one** prompt file, the persona as the only variable. Writing one rubric and varying the lens is what keeps the panel's questions comparable; N prompts would produce N unrelated reviews.
2. **Verdict files** — one per juror, on disk in a panel directory. Not a transcript: a file is readable by the moderator, by the next session, and by a person a week later.
3. **A commitment gate** — the verdict file must contain a line naming a position, and the panel refuses a verdict that does not. A juror that hedges has not reviewed.
4. **Reconciliation** — one moderator agent reads every verdict and writes the decision, naming disagreements rather than averaging them.

### The subject is one plan, never a wave

A wave holds slices from several plans and is *"sized by the agents available, bounded by what can land"* (`DESIGN-slice.md`). Four personas asked to interrogate a scheduling cohort produce four unrelated answers with no shared subject.

**A plan is the coherent unit** — its slices are one deliverable split for parallelism, which is what `/plot-reslice` produces and what `/plot-deliver` verifies as a whole.

### The gate is the part that makes this more than parallel subagents

Fan-out alone is a Task call. What this adds is that a verdict **cannot be recorded without a committed position**, which is exactly the conversion `plot-state-gate.sh` performed for `State:` writes: the rule existed in prose, agents routed around it, and a file check ended the argument.

The commitment line differs per caller — a Draft juror commits to proceed/amend/reject, a delivery juror to supported/refuted with the command it ran. The **mechanism** takes the required line as a parameter and does not know which.

### A juror's bound is its charter's

A panel is where [a-charter-bounds-what-an-agent-may-touch](2026-09-12-a-charter-bounds-what-an-agent-may-touch.md) pays off: a Draft juror needs to read plans, and a delivery juror needs to run diffs. Different scopes, declared rather than instructed. A Draft juror with no Bash cannot inspect the implementation it is supposed to judge blind.

This slice does not depend on that one — an unbounded panel works — but the two compose and the dependency runs this way.

### Open Questions

- [ ] How many jurors? Four lenses is a guess. The panel takes N and the callers choose; the first real number comes from running it.
- [ ] Does a unanimous panel skip reconciliation? Cheaper, but a moderator reading four agreements is also how a shared blind spot gets named. Leaning no.
- [ ] Where do verdict files live — the desk, or a panel directory beside the plan? The desk is transient and reaped; a plan's questions may be worth keeping.

## Slices

### A panel questions one plan (Branch: feature/a-panel-questions-one-plan)

The panel helper: fan-out over one prompt, verdict files, the commitment gate, and the moderator that reconciles.

## Notes

The panel replaces no existing skill by itself. It is the mechanism [a-plan-is-questioned-before-it-is-approved](2026-09-12-a-plan-is-questioned-before-it-is-approved.md) consumes twice.
