## Implementation brief — the-workflow-has-phases (slice: Naming what the workflow is)

- **Plan (canonical):** `docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md` on `main`
- **Branch:** `feature/the-workflow-has-phases` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of five. Slice 1 (`a-plan-has-a-state`) merged as **#711**. **This slice was amended after approval on 2026-09-05** — read the amendment in the plan, not just the original paragraph.

## What this delivers

`DevelopmentWorkflow` in the domain, holding `Discovery → Design → Development → Testing → Release`, their order, and who leads each.

## The duplication is exact, and that is the easy half

**`BOARD_PHASES` is declared twice and the two are byte-identical.** Verified 2026-09-06 — `domain/rules/phase.ts:12` and `board/contract/schema.ts:202` produce no diff.

`schema.ts:1095` already re-exports `toBoardPhase` from the domain, so the board imports one thing from there and hand-copies its neighbour. **One import line closes it**, and the drift this repo has measured three times cannot start here.

**`PHASE_LEADERSHIP` moves too** (`schema.ts:212`). Who owns Discovery against who owns Testing is a fact about how a team works; the board renders what it reads. **The icon travels with it** — it is how a leader is named without colour, which the board must not be free to drop.

## The order is data, not a second enforcer

**The transitions already gate the work.** `deliver()` accepts `approved` or `delivered` and refuses `draft`. A phase ordering that refused independently could disagree with the rule that actually decides, and **a disagreement between two enforcers is worse than one enforcer**.

So the phases carry their sequence as data. What refuses is the state transition.

## THE AMENDMENT — a story maps too

**This is the part the original paragraph did not have.** Settled 2026-09-05:

> **Stories and plans have states; only the workflow has phases.** Both states map onto the workflow's phases, and neither entity carries one.

**Verified 2026-09-06: `toBoardPhase` (`rules/phase.ts:40`) takes a plan state and nothing else** — a `string`, switched over five plan states, returning `null` for anything unknown. `transitions/story.ts` mentions `Phase` **zero** times. So a phase currently reads as a property of one plan.

**It is not.** Discovery produces an **approved story** — brainstormed, challenged, agreed. Design produces **approved, dispatchable plans** from it. A plan cannot be *in Discovery*, because a plan is what Discovery has not produced yet.

**That is why `design` has been entered by 0 of 207 plans**: it is a plan state naming a phase whose output is plans. The state was declared where the mapping belongs.

**So the mapping is from EACH state set.** `StoryStatusSchema`'s six values map onto the same five phases the plan states map onto.

## The assertions

Three, and the third is the amendment's:

1. **A plan state maps to exactly one phase**, including `null` for a state the workflow does not know. `toBoardPhase`'s tests — **11 references in `packages/domain/test/phase.test.ts`** — move with it and keep passing, which is what proves the concept moved rather than got rewritten.
2. **The phase order agrees with the state transitions** — no state maps to a phase earlier than the phase its predecessor maps to. That is the one property a derived order can get wrong.
3. **A story status maps to exactly one phase**, held the same way and asserted the same way.

## Shape

**Readings as values.** The rule performs no I/O; a caller reads and passes in. `rules/quiet.ts` and `rules/eligible.ts` are the models.

**Arrow functions**, purity gate holds — outside `adapters/`, the domain imports `zod` and nothing else.

**TSDoc says what an export does**, not why it was decided. The measurements above belong in the commit message, where `git log -S` finds them.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**The existing 11 `toBoardPhase` assertions must pass unchanged.** A rewrite that needs them edited is a rewrite, not a move.

## Done when

- `DevelopmentWorkflow` exists in the domain with the five phases, their order, and their leadership
- `BOARD_PHASES` is declared once; the board imports it
- `PHASE_LEADERSHIP` and its icons live in the domain
- a story status maps to exactly one phase, asserted by a test
- the existing `toBoardPhase` tests pass unchanged
- the gates above pass

## Do not

- **Do not make the phase order refuse anything.** The state transitions gate the work; two enforcers can disagree.
- **Do not drop the leadership icon.** It names a leader without colour.
- **Do not give a story or a plan a `phase` field.** Both have states; the phases are the workflow's, and that separation is the whole plan.
- **Do not remove the `design` state in this slice.** Its zero users are evidence for the mapping, and removing a state is a different change with its own consequences.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
