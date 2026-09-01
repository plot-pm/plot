# An interrogation records itself

> A plan questioned by hand shows no rounds badge, because nothing writes the
> round it was questioned in.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 0
- **Approved:** 2026-09-01, Jan Wloka, in-session
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-09-01, Jan Wloka, `docs/an-interrogation-writes-its-round`
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

**The instruction exists too, and is complete.** Checked 2026-09-01:
`skills/challenge-the-plan/SKILL.md` Phase 5b step 3 already says *"write
`- **Rounds:** N` to `## Status`"*, specifies replace-or-insert-after-`Impl:`,
and warns against a greedy match that would destroy the transition records.
**Both writes, one value — they cannot disagree by construction.**

**So the defect is narrower than a missing convention.** The field parses, the
skill writes it, and the instruction is careful. What is missing is that
**nothing addresses the interrogator who is not running the skill**, and nothing
notices when the record is absent. An interrogation conducted directly — reading
the plan, measuring its claims against the code, weaving the answers back — is
exactly the path that leaves no trace, and it is also the path that produces the
findings a question-generator cannot.

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

- `docs/an-interrogation-writes-its-round` — **the skill's Phase 5b already writes the field correctly; do not rewrite it.** What it lacks is one sentence saying the record is owed by anyone who interrogates, skill or not. The plan format's own documentation gains `Rounds:` where `Phase:` and `Review:` are described — `plot-plan-meta.sh` reads it from three sources and only the docs are silent, which is why a hand interrogation does not know it exists. → #599

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
