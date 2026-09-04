# The workflow owns the word phase

> A delivered plan is ready for testing: its **state** is `delivered`, its **phase** is `Testing`. One word carries both today, declared twice in the domain meaning different things — and the work each phase contains is modelled nowhere.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- A plan has a **state** and the development workflow has **phases**, in the code and in the plan file: `- **Phase:**` becomes `- **State:**`, and Plot reads either spelling for good.

Board impact: yes, and in three places. `BOARD_PHASES` stops being declared twice — the board imports it as it already imports `toBoardPhase`. `PHASE_LEADERSHIP` moves to the workflow and the board renders what it reads. The plan file's field is renamed, so the parser the board consumes reads both spellings. **The wire key stays `phase`**: renaming it breaks every reader of `/api/board` and teaches nobody.

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

**The development workflow has phases** — `Discovery → Design → Development → Testing → Release`. They exist in the domain, correctly ordered and correctly named, and `rules/phase.ts:7` calls them *"the columns a board shows"*. So the workflow's lifecycle is modelled as a **rendering concern**, and `toBoardPhase` (`:40`) — which maps a plan's state to a phase — reads as a presentation helper rather than as the relation between two domain concepts.

**The mapping is not untested, and the phases carry more than an order.**
`toBoardPhase` has 14 tests (`board/test/unit/phases.test.ts`) plus a second
file asserting `delivered → Testing` specifically. And
`board/contract/schema.ts:212` declares
`PHASE_LEADERSHIP: Record<Phase, { icon, who }>` — **who leads each phase**,
carried as a symbol and a word because *"roughly one man in twelve distinguishes
red from green poorly"*. Who owns Discovery against who owns Testing is a fact
about how a team works, not a drawing instruction. The workflow concept is
therefore split across two packages, and the half that is most obviously domain
knowledge sits in the board's contract file.

**And `BOARD_PHASES` is declared twice, byte-identically** —
`domain/rules/phase.ts:12` and `board/contract/schema.ts:202` — while
`schema.ts:1095` re-exports `toBoardPhase` **from the domain**. The board
imports the function and hand-copies the values it operates on. That is the
same shape as the `StoryStatus` duplication `a-lifecycle-is-enforced-by-a-test`
records: two declarations that agree today and drift the moment one is edited.

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

### The rename reaches the file field too

`Phase` → `PlanState` and the `phase-*` refusal reasons → `state-*`. Measured 2026-09-04: **221** occurrences in `packages/domain/src`, **528** in `packages/board/src`, **308** in `skills/plot/scripts/*.sh`.

**And `- **Phase:**` becomes `- **State:**` in the plan files.** An earlier draft
stopped at the code and called the field *"a separate decision"*. That split is
dishonest: if the word is wrong it is wrong where humans meet it, and a plan
arguing that a plan has states while every plan file says `Phase:` teaches the
conflation it exists to remove.

**The migration is small because every access is one regex.** Measured:

| what | count |
|---|---|
| plan files carrying `**Phase:**` | 196 |
| sprint and story files | 9 |
| parser read sites | 2 (`plot-plan-meta.sh:637` frontmatter, `:743` canonical) |
| domain write sites | 2 (`workflows/rendering.ts:96` `PHASE_LINE`, `decision.ts:46`) |
| shell writers | 3 (`plot-approve.sh:341`, `plot-deliver.sh:229`, and the scan) |
| template | 1 |
| skills naming the field | 11 |

**The parser reads both spellings, permanently.** `[Pp]hase[:*]` becomes
`([Pp]hase|[Ss]tate)[:*]` at every read site. That is not a migration aid to be
removed later: a plan file is a document a person may have written years ago or
copied from another project, and refusing to read `Phase:` would make Plot worse
at its own job. **Plot writes `State:` and reads either.**

**The wire key stays `phase`.** `schema.ts:328` and `:581` type it as
`z.enum(BOARD_PHASES)` and the board renders columns from it. Renaming a wire
field is a compatibility break for anything reading `/api/board`, and it buys
nothing the file rename buys — the word a human types is the one that teaches.

### Not chosen: leaving the field alone

The measurement above is what changed the answer. 196 files is a `sed` over a
directory plus a test that every one still parses; the reads stay dual forever,
so nothing breaks the moment the rename lands and nothing breaks for a plan
written before it.

### Not chosen: folding this into `a-lifecycle-is-enforced-by-a-test`

It began as a slice there and reached 63 lines against siblings of 5–8, because it argues for a concept rather than describing a branch. It also has to land **before** those four rules or they copy the conflation into four new files — a dependency between slices of one plan is a worse expression of that than a dependency between plans.

### Open Questions

- [ ] **Does `Release` the phase and `released` the state need different names?** Four of the five phases differ from their nearest state; this one does not, and a mapping where one pair is identical invites the two to be conflated again.
- [ ] **Where do the fleet's three workflows belong?** `assign`, `reap` and `supervise` act on agents and desks rather than on a plan. They may be a second workflow with its own phases, or they may not be phased work at all.

## Branches

### Naming what a plan is

- `feature/a-plan-has-a-state` — `Phase` → `PlanState` in `transitions/plan.ts`, the `phase-*` refusal reasons → `state-*`, and the callers through the domain and board. **Asserted: nothing named `Phase` in the domain refers to a plan.** The file field and the wire key are untouched, so the board renders identically and 196 plan files parse unchanged.

### Naming what the workflow is

- `feature/the-workflow-has-phases` — `DevelopmentWorkflow` in the domain, holding `Discovery → Design → Development → Testing → Release`, their order, and **who leads each**. `PHASE_LEADERSHIP` moves out of `board/contract/schema.ts:212`: who owns Discovery against who owns Testing is a fact about how a team works, and the board renders what it reads. The icon travels with it — it is how the leader is named without colour, which the board must not be free to drop.

  **`BOARD_PHASES` stops being declared twice.** `domain/rules/phase.ts:12` and `board/contract/schema.ts:202` are byte-identical today while `schema.ts:1095` already re-exports `toBoardPhase` from the domain; the board imports the values the same way. One import line, and the drift this repo has now measured three times cannot start here.

  **The order is a view of the plan's states, not a second machine.** The
  transitions already enforce it — `deliver()` accepts `approved` or
  `delivered` and refuses `draft` — so a phase ordering that refused
  independently could disagree with the rule that actually gates the work, and
  a disagreement between two enforcers is worse than one enforcer. The phases
  carry their sequence as data; what refuses is the state transition.

  **Asserted: a plan state maps to exactly one phase**, including its `null` for
  a state the workflow does not know — `toBoardPhase`'s 14 tests move with it
  and keep passing, which is what proves the concept moved rather than got
  rewritten. **Asserted: the phase order agrees with the state transitions** —
  no state may map to a phase earlier than the phase its predecessor maps to,
  which is the one property a derived order can get wrong.

### Naming the work in a phase

- `feature/a-phase-names-its-work` — each phase declares which workflows belong to it, giving `WorkflowName`'s flat eight-value union its missing structure. **Asserted: the fleet's workflows are not phases of this one** — `assign`, `reap` and `supervise` act on agents and desks, and a list that mixes them with `approve`/`deliver`/`release` cannot answer *what comes next*.

### The states nothing can write

- `feature/a-plan-can-be-rejected` — `reject()` and `supersede()` in
  `transitions/plan.ts`. **Both states already exist and neither is
  reachable:** `Phase` declares them (`:19`, `:20`), the parser accepts them
  (`plot-plan-meta.sh:338`), `plot-reconcile-scan.sh:662` acts on them, the
  board drops such plans from its cards — and **four plan files carry them
  today, written by hand**: three `Superseded`
  (`a-wave-is-a-thing-not-a-label`, `the-plan-actions-read-a-field-that-is-always-null`,
  `the-row-is-legible`) and one `Rejected` (`the-board-suite-fits-its-budget`).

  A state a person has to write by hand, into a file the whole estate reads, is
  the shape this story exists to remove. Every other state has a transition
  that records who did it and when; these two have a text editor.

  **The two differ and the plan must not merge them.** `rejected` is a verdict —
  somebody decided this will not be built. `superseded` is a relation — another
  plan replaced this one, and the record is worth nothing without naming which.
  So `supersede()` takes the replacing plan's slug and `reject()` does not.

  **Asserted: a Delivered plan cannot be rejected** — the refusal that stops a
  verdict erasing landed work, in the same `Precondition` / `RefusalReason`
  shape as the three transitions beside it. **Asserted: a superseding plan is
  named**, so a `Superseded:` record with no slug is refused rather than
  written. **Asserted: the four existing files parse unchanged** — this slice
  gives their state a writer, it does not restate what they already say.

  It is in this plan rather than in `a-lifecycle-is-enforced-by-a-test` because
  that plan writes `transitions/` files for **other** entities; the plan's own
  state model is what this plan settles, and a rename that leaves two of its
  states unreachable has not settled it.

### Renaming the field every plan carries

- `infra/a-plan-file-says-state` — the migration. `- **Phase:**` becomes
  `- **State:**` in **196 plan files** and **9 sprint and story files**; the
  template, the 11 skills that name the field, and the three shell writers
  follow. The parser gains `([Pp]hase|[Ss]tate)` at both read sites
  (`plot-plan-meta.sh:637`, `:743`) and the domain at both write sites
  (`workflows/rendering.ts:96`, `decision.ts:46`).

  **It edits the `## Status` section and nothing else, and the domain already
  owns that scoping.** `withPhase` (`workflows/rendering.ts:99`) is confined to
  that section for exactly this reason, in its own words: a plan that QUOTES a
  status block in its prose *"would otherwise have its illustration rewritten
  too, silently corrupting the very files that specify the format."* **24 plan
  files mention `Phase:` more than once** — one of them six times — so a blanket
  `sed` would rewrite the documentation of the field it is renaming. The
  migration reuses `withPhase`'s rule rather than re-learning it.

  **Then the prose is updated deliberately, as a second pass.** Leaving 24 files
  describing a field that no longer exists trades one wrong document for
  another. The difference is that a person decides each one: a delivered plan
  explaining why the old format read `Phase:` is history and stays, while a
  skill or a template telling somebody what to type must say `State:`.

  **Sprints are renamed too, and on purpose rather than by regex.** Nine sprint
  and story files carry `**Phase:**` with their own values — `Planned`,
  `Active`, `Closed`, which are `SprintState`'s. A sprint has a **state** for
  the same reason a plan does: it is an artefact Plot writes, so Plot records
  what it did to it. That is a decision about a second entity and it is stated
  here rather than left to a pattern match. **Asserted: `plot-sprint-release.sh`
  reads a renamed sprint unchanged.**

  **The dual read is permanent, not scaffolding.** A plan file is a document
  someone may have written a year ago or copied from another project. Plot
  writes `State:` and reads either, for good — a Plot that refused to read
  `Phase:` would be worse at its own job than the one that confused two words.

  **Asserted: every existing plan still parses, byte-for-byte identically.**
  The gate is `plot-plan-meta.sh` over all of `docs/plans/*.md` before and
  after, with **zero** differences — the same sweep
  [`plot-parser-ignores-fenced-code-blocks`] established when the parser last
  changed. **Asserted: a file still saying `Phase:` parses after the rename**,
  which is the property that makes the dual read a contract rather than a
  leftover.

  **The wire key is untouched.** `schema.ts:328` and `:581` keep `phase`; the
  board keeps rendering. Renaming a wire field breaks every reader of
  `/api/board` and teaches nobody anything — the word that teaches is the one a
  person types.

  Last, because it is mechanical and the concept has to be right before 196
  files are rewritten to match it.

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

**Interrogated 2026-09-04, one round**, and it moved two things. The plan claimed
the phase mapping was untested and filed purely as rendering; both were wrong —
`toBoardPhase` has 14 tests, and `PHASE_LEADERSHIP` carries who leads each
phase, which is domain knowledge the board was holding. The round also found
`BOARD_PHASES` declared twice byte-identically while the board already imports
`toBoardPhase` from the domain.

And it reversed the scope. The plan had kept `- **Phase:**` in the file and
called the field a separate decision; the operator's answer was that the split
is dishonest — a plan arguing that a plan has states, while every plan file says
`Phase:`, teaches the conflation it exists to remove. The measurement made it
tractable: 196 plan files, 9 sprint and story files, and seven code sites of one
regex each.

**Round 2, 2026-09-04.** Surveyed what the estate actually writes in the field,
which found three things the migration had not accounted for.

**`Phase:` is overloaded a fourth way.** Nine sprint and story files carry it
with `SprintState`'s values — `Planned`, `Active`, `Closed`. The rename now
covers them as a stated decision about a second entity, rather than as
something a regex would have done silently.

**24 plan files mention `Phase:` more than once**, one of them six times: prose
explaining the format, quoted Status blocks. The domain had already learned this
— `withPhase` is scoped to `## Status` because rewriting a quoted block *"would
silently corrupt the very files that specify the format"* — and the migration
now reuses that rule instead of re-learning it, with a deliberate second pass
over the prose.

**Four files already carry a state nothing can write.** Three `Superseded`, one
`Rejected`, hand-edited, in a field the whole estate reads.
`feature/a-plan-can-be-rejected` gives both a transition, and separates them:
`rejected` is a verdict, `superseded` is a relation that must name the plan
replacing it.

The round also **narrowed** an assertion. The plan had claimed a phase ordering
that refuses; the states already enforce the order (`deliver()` accepts
`approved` or `delivered`, refuses `draft`), so a second enforcer could only
disagree with the first. The phases carry their sequence as data, and what is
asserted instead is that the two agree.
