# A plan is questioned before it is approved

> The panel runs twice: over a Draft plan and its siblings, where the answer can still change the design; and at delivery, where it can only report the gap.

## Status

- **State:** Draft
- **Type:** feature
- **Story:** an-agent-is-declared-and-corrected
- **Review:** pr
- **Impl:** own branches

## Changelog

- A Draft plan is questioned by several lenses in parallel, reading the plan and its sprint siblings, and the result lands in Open Questions with a recorded round.
- `/plot-deliver` step 5 gains lenses over its existing per-PR fan-out, and its verdicts must name what was executed rather than read.

<!-- Board impact: the rounds badge already reads `Rounds:`, so a panel run
     shows up without a board change. -->

## Motivation

**73% of plans reach implementation unquestioned.** 262 plans, 71 with a `Rounds:` field. The existing interrogation is sequential and interactive — four questions per round, five to ten rounds for coverage, a person answering each. The uptake measures the cost.

**Two reviews, and neither substitutes for the other.** A Draft panel asks *should we build this?* and can change the design, because nothing is built. A delivery panel asks *did we build it?* and cannot change the design, only report the gap. A Draft panel cannot see that a slice silently dropped a deliverable; a delivery panel cannot un-approve an architecture.

**Both failures are measured on this estate.** Five plans in one week proposed building something the estate already had — which is why `plot-deliverable-search.sh` exists, and it reports rather than refuses because two of the five were legitimately replacing what they matched. And step 5 exists because a changelog entry written at planning time described intent nobody implemented.

**A plan is questioned alone, so a contradiction between siblings is invisible to both.** Measured in this story's own preparation: a plan proposed fixing a per-board cap that `fleet.ts:2691` already read from the shared registry. A juror holding the sibling plans would have seen it.

## Design

### Approach

Two callers of [a-panel-questions-one-plan](2026-09-12-a-panel-questions-one-plan.md), sharing the mechanism and nothing else.

**The Draft panel** runs after `/plot-idea` and before `/plot-approve` — where `challenge-the-plan` already sits, *"design-phase: idea → challenge → approve."* Its subject is the plan **plus its sprint siblings**. Its verdicts commit to proceed, amend or reject. Its output is the Open Questions section and a `Rounds:` increment, which is what the existing skill already writes, so the board's rounds badge needs no change.

**The delivery panel** extends step 5, which already fans out per PR. It gains lenses over that fan-out, and the commitment line becomes the gate the step states in prose today: a verdict must name the command it ran, not the diff it read.

### It replaces the loop, not the skill

`/challenge-the-plan` keeps its name, its Open Questions section and its `Rounds:` record. What changes is that the questioning is parallel and persona-driven rather than four-at-a-time and interactive.

The alternative — a second interrogation surface beside the first — means plans get challenged two ways and neither is authoritative. One plan-interrogation surface, a faster engine inside it.

**Interactive mode stays.** A person who wants to answer questions directly should still be able to; the panel is what runs when nobody is there, which is the case that produced the 27%.

### The lenses do not transfer between the two panels

A Draft lens asking *does the estate already have this?* is meaningless at delivery, where the thing is built. A delivery lens asking *did you run it?* is meaningless at Draft, where there is nothing to run.

So each caller names its own lenses and the mechanism knows none of them.

### What is deliberately not a lens

**Prose quality.** A natural-language pass is not a design objection, and a juror that reports awkward wording alongside a missed deliverable dilutes both. Prose belongs to a writing agent before the PR, which is a separate question this story does not settle.

### Open Questions

- [ ] Which siblings? The sprint is one answer; plans whose slices are eligible alongside this one is another, and closer to *what will be built at the same time*. The sprint is cheaper and is where this starts.
- [ ] Does a Draft panel gate `/plot-approve`, or advise it? Gating makes 73% of plans suddenly unapprovable. Advising is the honest start, and a gate is a later decision with data behind it.
- [ ] Does `Rounds:` distinguish a panel round from an interactive one? They are not equivalent work. A second field is a plan-format change and needs its own argument.

## Slices

### A plan is questioned before approval (Branch: feature/a-plan-is-questioned-before-it-is-approved)

The Draft panel and its lenses, reading the plan plus its sprint siblings.

### A delivery verdict names what it ran (Branch: feature/a-delivery-verdict-names-what-it-ran)

Step 5 gains lenses over its existing per-PR fan-out, and its commitment gate requires the command a juror executed rather than the diff it read.

## Notes

The Draft panel is the one with a measured gap in front of it: 73% of plans go unquestioned, and the reason is cost rather than disagreement. The delivery panel improves a step that already runs on every delivery.
