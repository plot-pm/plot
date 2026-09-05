# Sprint: The domain owns the lifecycle

> Plot's elements each have a lifecycle, and the rules governing them live in
> prose — in `DESIGN-*.md`, in `CLAUDE.md`, in comments beneath shell
> conditionals. This sprint moves those lifecycles into the domain and puts a
> test behind each refusal, so a rule that is violated fails a build rather than
> waiting for someone to read a diff.

## Status

- **Phase:** Planned
- **Start:** 2026-09-05
- **End:** 2026-09-19
- **Release:** 2.14.0

## Sprint Goal

**Every domain element's lifecycle is enforced by a test, and no script changes
a lifecycle state without asking the domain.**

Two halves, and the second is what makes the first stick. A rule the domain owns
that a script routes around is not enforced; a script that asks a rule which
refuses nothing is not governed.

**Three conditions, and all three must hold.**

| condition | what it rules out |
|---|---|
| **named** | a concept the code discusses in two vocabularies — a plan's *states* called its *phases*, a Slice called a Wave |
| **owned** | a lifecycle decided in a shell script the domain cannot call, or in a comment nothing enforces |
| **enforced** | a rule written down and violated anyway, which is where this sprint starts |
| **routed** | a script that changes a lifecycle state on its own authority |

**The fourth is measurable, and the estate is further along than it looks.**
`plot-approve.sh` and `plot-deliver.sh` ask the domain through
`plot-transition.mjs`, and `plot-reap.sh` says so in its own header: it *"reads
`packages/domain/src/rules/reapable.ts` and ACTS on the answer; it holds no
judgement."* That is the shape, already working, in the script whose five
refusals are the most consequential in the fleet.

**`plot-release-refs.sh` is the one that decides for itself.** Its five guards
answer the same question about the same desk — is this branch finished with? —
and they are written separately, in a script that deletes a remote ref, which
`plot-reap.sh`'s own comments call out as the operation that cannot be undone.
Two implementations of one judgement, where the more dangerous one is the copy.

**The third is what makes it a sprint rather than a refactor.** `CLAUDE.md`
already states the failure mode — *"If prose-only, it's a rule and will
eventually be violated"* — and the estate proved it three times while these
plans were being written:

- an approval record landed **inside** an HTML comment block on two plans,
  because `plot-approve.sh` inserts after the first placeholder it finds. Both
  reported `record=written`; both parsed empty.
- three plans authored under the story that exists to fix Plot's vocabulary all
  wrote `## Branches`, months after a migration script renamed the estate.
- a plan bundled six branches under three headings, which
  `DESIGN-slice.md` forbids in one sentence.

Every one was caught by a person reading output, and every one is the shape a
rule takes when nothing refuses it.

### What "owns" means here

**A rule takes readings as values and returns a refusal or a decision.**
`transitions/plan.ts` is the working example — `Precondition`, `RefusalReason`,
`Decision`, 41 tests with 24 refusal assertions, called from a bundle by
`plot-approve.sh`, `plot-deliver.sh` and `server/entry/transition.ts`. One rule,
three entrances, no second implementation.

**But there are two shapes, and the sprint says so up front.** `DESIGN-plan.md`:
*"Plan and Story are the only two entities whose state is a stated fact rather
than a derived relation."* A Plan's transition returns **writes the caller
performs**; an Agent's, a Worktree's and a Slice's returns **a verdict on a
change that already happened**. The refusals are shared; the decisions are not.

### No release until a lifecycle can refuse

**2.14.0 waits until at least one lifecycle beyond `plan` refuses in
production** — not until a plan is delivered, not until this sprint closes.

The reason is the previous sprint's own lesson, recorded in
`2026-W36-the-domain-is-one-implementation.md`: 2.12.0 shipped four entries and
not one was a change a user notices. A sprint that renames `Phase` to
`PlanState` and adds a `transitions/story.ts` nobody calls has moved code and
changed nothing. **The condition is that something is refused that was
previously allowed.**

## MoSCoW

Stories: [[the-domain-knows-what-plot-knows]] — every plan here belongs to it,
and it holds no plans outside this sprint.

### Must Have

- [ ] [the-workflow-owns-the-word-phase] A plan has a **state**, the development workflow has **phases**, and each phase names its work — a delivered plan is in the Testing phase: the state is `delivered`, the phase is `Testing`, and one word carries both today. `Phase` is declared twice in `packages/domain/src` meaning different things, and `PHASE_LEADERSHIP` — who leads each phase — sits in the board's contract file. **Approved 2026-09-04, 5 slices, 2 rounds.** Lands first: the four `transitions/` files below are written after it or they copy the conflation into four new files
- [ ] [a-lifecycle-is-enforced-by-a-test] `transitions/` for Story, Agent, Worktree and Slice, each refusing with a test per refusal, plus the ratchet that stops the next lifecycle hiding. **Approved 2026-09-04, 5 slices, 2 rounds.** Story leads: it is the one disagreement still standing after two of the three cited violations were fixed while the plan waited
- [ ] [every-element-is-a-domain-concept] Branch, Plan and Slice become types that carry the rules judging them — the reaper's five refusals and the ref-deleter's five guards are one question asked twice. Amended after approval with the recognition rule: given a ref, Plot says whether it is a plan under review, a slice's branch, or nothing Plot planned. **Approved 2026-09-04, 6 slices, 1 round**

### Should Have

- [ ] [a-branch-state-is-derived-once] Three domain rules read `BranchState` and none produces one — the eight states are decided in four places across a 4,008-line shell script, and `unknown` versus `open` turns on whether a question was put or went unanswered. **Draft (#702), 2 slices, 2 rounds.** Should rather than Must because the three above give the domain its words and its rules; this gives it an answer it currently has to be told

### Could Have

- [ ] [the-scripts-say-slice] The reconcile scan says slice where it means slice — section 7 read *"Unsliced waves (a wave holds one branch)"*, a Slice described in Wave's vocabulary by its own parenthetical. Footer keys renamed with the skill documenting them. **#703, no plan — a rename small enough to be its own PR**

## Notes

Written 2026-09-05. The four plans were written and interrogated on 2026-09-04
— eight rounds between them — and three approved the same day.

**Every round changed something, which is the argument for the sprint's own
goal.** Round 2 on `a-lifecycle-is-enforced-by-a-test` found that two of its
three cited violations had been **fixed by the estate while the plan sat
unapproved**, and that its Agent assertion would have passed on the day it was
written — a refusal that refuses nothing. Round 2 on `a-branch-state-is-derived-once`
replaced its entire gate: a byte-identical differential over live output is
impossible when the scan asks a host that can throttle.

**What this sprint does not do.** It does not give the remaining ~30 state enums
rules. The ratchet in `a-lifecycle-is-enforced-by-a-test` makes every enum
declare its kind — lifecycle, reading, or classification — and that declaration
is the review that finds the next lifecycle nobody had noticed. Guessing which
of the thirty deserve rules is exactly the error this sprint's own plans made
twice, naming `SprintState` and `PrState` as non-lifecycles when both transition.
