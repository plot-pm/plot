# Sprint: The domain is one implementation

> Plot's entities, states and rules exist — but each in several places, none of
> them named as the domain. This sprint moves the domain that already exists
> into a package the rest can depend on, and gives it the rules that currently
> live apart from it.

## Status

- **Phase:** Active
- **Start:** 2026-08-29
- **End:** 2026-09-12
- **Release:** 2.12.0

## Sprint Goal

**One implementation of every lifecycle rule, in a package that reaches
nothing.**

Measured on `main` 2026-08-28:

| | |
|---|---|
| `contract/schema.ts` | **4,052 lines**, 353 zod schemas |
| its imports | **one** — `zod` |
| its world access | **none** |
| importers | **53** — 37 in the app, 16 in the server |
| `FleetPulse` validated at | **one place** — `pulse-bridge.ts:201` |

**That module is already a pure domain layer sitting inside the board.** It
does not reach a disk, a process or a network; both halves of the application
import it; everything downstream already depends on its shapes.

**So the work is not to build a domain. It is to move the one that exists**
somewhere it can be depended on — and to bring the rules that currently sit
outside it back in.

## MoSCoW

Stories: [[the-master-agent-holds-the-fleet]] (the domain half) — and it is the
prerequisite two other stories are waiting on; see *What this sprint unblocks*.

### Must Have

- [ ] [the-domain-moves-out-of-the-board] A `@plot-pm/domain` package carries Plot's entities, states, rules and transitions; the board imports them rather than defining them — measured: `contract/schema.ts` is 4,052 lines with one import and no world access, i.e. a pure domain layer that no other component can depend on because it lives inside the board

### Should Have

- [ ] [the-domain-speaks-slices] The code calls a slice a slice, and `Wave` is freed for the cohort the fleet lands together — measured 2026-08-29: `FleetWaveSchema` holds `branches[]`, belongs to one plan and is persisted in the pulse, which is a **Slice** by every property `DESIGN-slice.md` defines, while the real Wave (cross-plan, formed at dispatch, persisted nowhere) does not exist in code at all

### Could Have

- [ ] [a-domain-rule-has-one-owner] Any lifecycle rule found duplicated **while moving** gets its second implementation deleted in the same slice, rather than noted for later — opportunistic, and only where the two provably agree

## Notes

### Why only one Must, when three domain plans exist

**Because the other two cannot be started.** The three plans form a strict
chain, each stating its dependency in its own header:

```
the-domain-moves-out-of-the-board          APPROVED   4 slices   startable now
  └─ the-domain-runs-the-workflows-…       DRAFT      4 slices   Depends on ↑
       └─ production-calls-the-domain-…    DRAFT      5 slices   Depends on ↑
```

Putting all fourteen slices in one sprint would promise work the fleet cannot
begin: nine of them are blocked on day one, and two of the three plans are not
approved. **A timebox whose contents cannot start is not a plan, it is a wish.**

The two dependent plans are the obvious next sprints. They are named here, and
deliberately not counted here.

### The four slices, and why they are ordered as they are

| slice | branch | what moves |
|---|---|---|
| Moving | `feature/the-domain-package-exists` | the package, the purity gate, the entity graph out of `contract/schema.ts` |
| Deliverable | `feature/one-deliver-rule-decides-in-the-domain` | `allWavesMerged` + its 25 tests; three board call sites import it |
| Entities | `feature/the-entities-carry-their-states` | the ten entities the pulse does not carry, each with its identity kind |
| Transitions | `feature/a-transition-is-one-value` | `plan.approve()`, `.deliver()`, `.release()` — returning what to write, not writing it |

**Moving is first because everything else imports what it creates.** The other
three are independent of each other once it lands.

### A move, not a parallel build

An earlier draft proposed building fresh entities *beside* the pulse types and
proving agreement with a corpus test. **That would have created a third
implementation of shapes that already exist twice** — the duplication
[stage 2 §5](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
forbids — and required a later plan to remove it.

**A move creates no duplication at all**, so there is nothing to remove and no
window in which two answers exist. This is the sprint's central bet, and the
thing to abandon the design over if it stops being true.

### What the existing tests can and cannot prove

**They prove behaviour is preserved. They cannot prove it is right.** A rule
that was wrong before the move is wrong after it, and unedited tests will
happily confirm the wrong answer in its new location.

So the gate for each slice is not "the tests still pass" — it is the plan's own
`Done when` clauses, plus the reconcile scan on the real estate. **The scan is
what says a moved rule is subtly wrong**, because it derives from git rather
than from the code under change.

### Board impact is YES, on every slice

Types move out of `contract/schema.ts` and the board imports them back. **The
pulse contract does not change** — the same shapes, validated by the same zod,
resolved from a different package. The artifact must be rebuilt on every branch,
and the [Definition of Done](../definition-of-done.md) gates it in CI.

### What this sprint unblocks, and why those are not items here

**Two draft stories are waiting on this one, and neither has a plan.**

| story | needs | which slice supplies it |
|---|---|---|
| [[plot-agent-identity]] — *An agent is someone, not something running* | `Agent` and `Person` as entities with a declared identity kind | **Entities** |
| [[plot-plan-economics]] — *What a plan costs, and what the approval was worth* | a plan transition as a **value** that can be summed over | **Transitions** |

**They are named here and deliberately not counted here.** A story with no plan
is not a sprint item — it is a finding, and the fleet cannot start one. This is
the shape the deferred sprint states about its own contents (*"All eight items
are findings, not plans"*), and it is what makes a timebox unstartable.

**The dependency is real rather than thematic.** `plot-agent-identity` asks for
an identity that exists *before* dispatch and *survives* the branch; that is a
sentence about an entity with a state source, which is exactly what the Entities
slice constructs. `plot-plan-economics` asks what a plan cost and what its
approval was worth; a cost summed per approval needs the approval to be a value
somewhere, which is what the Transitions slice returns instead of writing.

**Both become plannable the moment those two slices land** — and neither is
plannable before, which is the argument for doing this sprint first rather than
these stories.

### What this sprint displaces

`a-half-landed-workflow-says-so` (W36 as originally numbered) was the planned
next sprint and is **deferred, not dropped**. Its findings are real and its
detection already exists; nothing in it decays by waiting.

**One caveat worth stating, because it argued the other way.** That sprint makes
half-landed workflows report themselves — and a refactor of the lifecycle rules
is exactly the kind of change that produces half-landed workflows. Doing the
hygiene first would have spread the net before the fall. The trade is accepted
deliberately: the domain move is the larger structural win, and the reconcile
scan already reports the drift today even though nothing consumes it.

**So while this sprint runs, read `plot-reconcile-scan.sh` by hand** rather than
trusting a workflow to report its own incompleteness. That is the protection the
deferred sprint would have automated.
