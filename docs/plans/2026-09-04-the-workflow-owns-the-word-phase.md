# The workflow owns the word phase

> A delivered plan is ready for testing: its **state** is `delivered`, its **phase** is `Testing`. One word carries both today, declared twice in the domain meaning different things — and the work each phase contains is modelled nowhere.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

## Changelog

- Plot's domain names a plan's states `PlanState` and gives the development workflow its five phases, so the two stop sharing one word.

Board impact: yes. `rules/phase.ts` is where the board reads its columns, and `BOARD_PHASES` moves behind the workflow concept. The wire field stays `phase`; the board keeps rendering what it renders.

## Motivation

**`Phase` is declared twice in `packages/domain/src`, meaning different things.**

| declaration | values | what it actually is |
|---|---|---|
| `rules/phase.ts:15` | Discovery, Design, Development, Testing, Released | the **workflow's phases**, filed as board columns |
| `transitions/plan.ts:13` | draft, design, approved, delivered, released, rejected, superseded, none | the **plan's states**, holding the workflow's word |

Neither is careless. Each is right about its own values and wrong about what it belongs to.

### The example that separates them

**A delivered plan is ready for testing.** Its **state** is `delivered` — a
fact its file states, written by `/plot-deliver` when every slice merged. Its
**phase** is `Testing` — where the work has got to, and what is done there is
reviewing, reaping and proving the thing works.

Neither word substitutes for the other. The state is a record of what happened
to the artefact; the phase is a place in the workflow with its own work. They
change for different reasons and are read by different questions: *what is this
plan?* against *what happens next?*

`toBoardPhase` (`rules/phase.ts:39`) is precisely this mapping —
`delivered → Testing` at `:48` — and it lives in a file about board columns,
with no test.

### Three concepts, two words, one of them borrowed

**A plan has a state.** `DESIGN-plan.md:810` already says so: *"Plan and Story are the only two entities whose **state** is a stated fact rather than a derived relation."* The sentence after explains the field name as an accident rather than a claim — *"the Issue spec could refuse a `state` field while this one carries `phase`."*

**The development workflow has phases** — `Discovery → Design → Development → Testing → Release`. They exist in the domain, correctly ordered and correctly named, and `rules/phase.ts:7` calls them *"the columns a board shows"*. So the workflow's lifecycle is modelled as a **rendering concern**, and `toBoardPhase` (`:39`) — which maps a plan's state to a phase — reads as a presentation helper rather than as the relation between two domain concepts.

**The plan states map onto the phases, and that mapping is not the interesting part.** What differs per phase is **the work**: writing and interrogating a plan in Discovery, cutting slices in Design, dispatching and implementing in Development, reviewing and reaping in Testing, tagging in Release. Nothing models that. `workflows/decision.ts:395` lists eight workflow names — `approve`, `assign`, `deliver`, `dispatch`, `reap`, `implement`, `release`, `supervise` — as a **flat union with no order and no phase**, mixing the fleet's (`assign`, `reap`, `supervise`) with the plan's.

### And the transitions are a third thing again

`approve`, `deliver`, `release` are what MOVE a plan between states. They are typed twice and never as a lifecycle: `type Verb` in `board/server/entry/transition.ts:44` — three of them, in the board, documented as *"which lifecycle step"* — and the eight-value `WorkflowName` above.

**Four declarations describe three concepts, and none owns any outright.**

### What it costs

A rule that wants to ask *what phase is this work in* has no concept to ask. `toBoardPhase` answers for a plan, in a file named for columns, with no test — and a plan whose state it does not recognise returns `null`, which the board renders as absent rather than as an unknown format. A phase ordering exists nowhere, so nothing refuses `Testing` before `Development`; there is no rule to refuse it with.

## Design

### Approach

**`DevelopmentWorkflow` becomes a domain concept holding the five phases and their order.** `PlanState` replaces `transitions/plan.ts`'s `Phase`. The plan-state → phase relation moves out of `rules/phase.ts` into the workflow, and the board becomes a **view** of a phase rather than the place a phase is defined.

**The work per phase is named, not just the phases.** Each phase declares which workflows belong to it, so `WorkflowName`'s flat union gains the structure it is missing — and the fleet's three are separated from the plan's five rather than sitting beside them.

### The rename's scope is the code, not the file format

`Phase` → `PlanState` and the `phase-*` refusal reasons → `state-*`. Measured 2026-09-04: **221** occurrences in `packages/domain/src`, **528** in `packages/board/src`, **308** in `skills/plot/scripts/*.sh`.

**The plan file keeps `- **Phase:**`.** 196 plan files carry it, humans type it, and the board ships it on the wire. The parser reads it with one regex per site (`plot-plan-meta.sh:743`) that can widen to `(phase|state)` when a format migration is worth doing on its own terms. This plan fixes the vocabulary **where the reasoning happens**; the field name is a separate decision with a migration attached.

### Not chosen: renaming the file field too

It would make the vocabulary uniform end to end. Rejected for now because it touches every plan ever written plus the wire format, and because the code rename delivers the whole benefit — a rule that reasons about a plan's state stops calling it a phase. A field name humans type is the last thing to change, not the first.

### Not chosen: folding this into `a-lifecycle-is-enforced-by-a-test`

It began as a slice there and reached 63 lines against siblings of 5–8, because it argues for a concept rather than describing a branch. It also has to land **before** those four rules or they copy the conflation into four new files — a dependency between slices of one plan is a worse expression of that than a dependency between plans.

### Open Questions

- [ ] **Does `Release` the phase and `released` the state need different names?** Four of the five phases differ from their nearest state; this one does not, and a mapping where one pair is identical invites the two to be conflated again.
- [ ] **Where do the fleet's three workflows belong?** `assign`, `reap` and `supervise` act on agents and desks rather than on a plan. They may be a second workflow with its own phases, or they may not be phased work at all.

## Branches

### Naming what a plan is

- `feature/a-plan-has-a-state` — `Phase` → `PlanState` in `transitions/plan.ts`, the `phase-*` refusal reasons → `state-*`, and the callers through the domain and board. **Asserted: nothing named `Phase` in the domain refers to a plan.** The file field and the wire key are untouched, so the board renders identically and 196 plan files parse unchanged.

### Naming what the workflow is

- `feature/the-workflow-has-phases` — `DevelopmentWorkflow` in the domain, holding `Discovery → Design → Development → Testing → Release` and their order; `BOARD_PHASES` becomes a view of it. **Asserted: a phase knows what may follow it**, so `Testing` before `Development` is refused by a rule rather than by nothing. **Asserted: a plan state maps to exactly one phase** — what `toBoardPhase` implements today and nothing tests, including its `null` for a state the workflow does not know.

### Naming the work in a phase

- `feature/a-phase-names-its-work` — each phase declares which workflows belong to it, giving `WorkflowName`'s flat eight-value union its missing structure. **Asserted: the fleet's workflows are not phases of this one** — `assign`, `reap` and `supervise` act on agents and desks, and a list that mixes them with `approve`/`deliver`/`release` cannot answer *what comes next*.

## Notes

**The template's `## Slices` heading does not parse as slices.**
`plot-plan-meta.sh:732` reads `## Slices` as the *waves* section and `:719`
reads `## Branches` as the branches — so a plan written from
`.plot/templates/plan.md` reports `slices=0`. Both sibling plans under this
story use `## Branches`, which is why they parse. This plan follows them.
Recorded here rather than fixed: it is a plan-format defect and belongs to
whoever owns the template, not to a vocabulary rename.

Written 2026-09-04, during the interrogation of `a-lifecycle-is-enforced-by-a-test`. The conflation was found by the operator reading a question of mine that called a plan's states its phases for the third time.

**The vocabulary lands before the lifecycle rules.** `a-lifecycle-is-enforced-by-a-test` writes four `transitions/` files; written first, they would copy the conflation into four new places, and renaming afterwards would be a second pass over work that had just landed.
