# An interrogation records itself

> A plan questioned by hand shows no rounds badge, because nothing writes the
> round it was questioned in.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 0
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- An interrogation records the round it happened in, so the board's rounds badge
  reflects the questioning a plan has actually had rather than only the
  questioning that ran through the skill.

Board impact: no board change. `PlanCard.tsx` already renders the badge and
`plot-plan-meta.sh` already reads three sources; what is missing is a writer.

## Motivation

**Measured 2026-09-01.** Five plans were interrogated across nine rounds in one
session — `one-account-has-one-budget` three times, `the-pulse-is-an-entity` and
`the-registry-supervises-its-agents` twice each, two others once. **Every one
showed no rounds badge**, and the parser reported `rounds: undefined` for all
five.

**Nothing was broken.** `PlanCard.tsx:284` renders the badge and states its own
rule — *"No badge where the plan records no interrogation: silence, not a
zero."* `plot-plan-meta.sh` reads `Rounds:` from `## Status`, then YAML front
matter, then a `CHALLENGE-THE-PLAN-METADATA` block. **The reader is complete and
the writer is conditional.**

**The gap is the entrance, not the mechanism.** `challenge-the-plan`'s Phase 5b
writes the metadata block. An interrogation conducted directly — reading the
plan, measuring its claims against the code, asking the operator, weaving the
answers back — writes nothing, and is indistinguishable afterwards from a plan
nobody has questioned.

**That is the failure the badge exists to prevent**, stated in its own comment:
*"has anyone pushed on this yet?… the one thing a reader of a Draft card cannot
see without opening the file."* A plan interrogated three times reads as
untouched.

## Design

### The record belongs to the plan, not to the skill

`Rounds:` in `## Status` is already the parser's **first-priority** source, above
front matter and above the block. So a plan can carry its own count without any
skill involvement — which is what makes a hand-run interrogation recordable at
all.

**So the fix is a convention with a home, not a new field.** The field exists;
what is missing is that nothing tells an interrogator to write it, and nothing
notices when they do not.

### Not chosen: infer rounds from git history

Counting commits that touch a plan would over-count — bookkeeping, PR
annotations and phase flips all touch it — and under-count an interrogation
whose findings landed in one commit. **A round is a judgement about what
happened, not a diff count.**

### Not chosen: require the skill

Making `/challenge-the-plan` the only way to interrogate would trade a missing
record for a missing interrogation. The direct path is often the better one: it
tests claims against the code, which the skill's question-generation does not.

## Branches

### Recording

- `docs/an-interrogation-writes-its-round` — `challenge-the-plan`'s instructions gain the `Rounds:` field beside the metadata block it already writes, and say that an interrogation run without the skill must increment it by hand. The plan format's own documentation gains the field where `Phase:` and `Review:` are described, since `plot-plan-meta.sh` already reads it and only the docs are silent.

### Noticing

- `bug/a-questioned-plan-says-how-often` — `plot-reconcile-scan.sh` reports a Draft plan that has been amended since its last recorded round, the way it already reports index drift: convenience, not a gate. **A missing round is not a defect** — a plan nobody has questioned is honestly unquestioned — so this reports the *disagreement* between a plan's edit history and its stated rounds, which is the case the badge gets wrong.

## Done when

- A plan interrogated without the skill carries its round, and the board shows
  the badge — asserted by parsing a plan with only a `## Status` `Rounds:` line.
- **`rounds: 0` still renders no badge**, and a plan with no field still reports
  `undefined` rather than `0`. The comment's *"silence, not a zero"* is the
  property; a fix that turns absence into zero breaks it.
- The scan reports a Draft plan edited since its last round, and reports it as
  convenience rather than in the gating sections.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  changeset.

## Notes

**Found by the operator noticing the badge was gone**, after nine rounds in one
session produced five plans that all read as unquestioned. The board was right;
the plans were silent.
