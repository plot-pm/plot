# The domain moves out of the board

> Plot's entities already exist — as `FleetPulse`'s `plans[] → waves[] → branches[]` in `contract/schema.ts`, a 4,052-line module whose only import is zod. This **moves** that graph into `@plot-pm/domain` and adds the rules and transitions the design specifies. A move, not a copy: no duplication is created, and the entities arrive already exercised by 53 importers.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A new `@plot-pm/domain` package carries Plot's entities, states, rules and transitions. The board imports them rather than defining them, and computes lifecycle rules through one implementation instead of its own.

<!-- Board impact: YES. Types move out of contract/schema.ts and the board
     imports them back. The pulse contract does not change — the same shapes,
     validated by the same zod, resolved from a different package. Rebuild the
     artifact on every branch. -->

## Motivation

**The design specified fourteen entities as if they were new. Most of them
already exist.** `FleetPulse` is `plans[] → waves[] → branches[]` plus a
summary — **Plan, Slice and Branch, already assembled** — and it has been since
the pulse had a schema. They were invisible to the design because they carry
transport names in a file called `contract/`.

**Measured 2026-08-28:**

| | |
|---|---|
| `contract/schema.ts` | **4,052 lines**, 353 zod schemas |
| its imports | **one** — `zod` |
| its world access | **none** (two hits are comments *about* other modules) |
| importers | **53** — 37 in the app, 16 in the server |
| `FleetPulse` validated at | **one place** — `pulse-bridge.ts:201` |

**That module is already a pure domain layer sitting inside the board.** It
does not reach a disk, a process or a network; it is imported by both halves of
the application; and everything downstream already depends on its shapes. The
work is not to build a domain — **it is to move the one that exists somewhere
it can be depended on, and to give it the rules that currently live apart from
it.**

**This replaces the plan's original approach.** An earlier draft proposed
building fresh entities *beside* the pulse types and proving agreement with a
corpus test. That would have created a third implementation of shapes that
already exist twice — the exact duplication
[stage 2 §5](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
forbids — and then required a later plan to remove it. **A move creates no
duplication at all**, so there is nothing to remove and no window in which two
answers exist.

## Design

### Approach

**A new workspace package, `packages/domain`, published as `@plot-pm/domain`.**
`pnpm-workspace.yaml` already globs `packages/*`, and
`check-changeset-packages.sh` derives valid changeset names from the workspace
rather than a hardcoded list — a new package is accepted the day it exists.

```
packages/domain/
  src/
    entities/     the pulse graph, moved: Pulse, Plan, Slice, Branch,
                  plus PR, Build, Release, Worktree, Agent, Machine,
                  Issue, Story, Sprint, Person
    ports/        interfaces only — no implementations here
    rules/        deliverable, eligible, reapable, dispatchable, approvable
    transitions/  approve, deliver, release — returning what to write
  test/
```

**Zod moves with the entities.** The domain owns both a shape and its
validator, because they are one fact: `FleetBranchSchema` *is* what a branch is,
and splitting the type from the schema would put the definition in two places
to avoid a dependency the module already has and already survives being pure
with.

**So the purity gate permits zod and nothing else:**

```bash
# fails if any module under src/ reaches the world
grep -rlE "from '(node:|fs|child_process|http|https|net)" packages/domain/src/
```

**Empty output is the gate**, and `contract/schema.ts` passes it today,
unmodified — which is the evidence that the boundary is real rather than
aspirational. It runs in CI beside `pnpm test`.

### What moves, and what stays

| | moves | stays in the board |
|---|---|---|
| `FleetPulse`, `FleetPlan`, `FleetWave`, `FleetBranch` | ✅ the entity graph | |
| `PrRecord`, `BuildRollup`, agent/worktree state | ✅ | |
| `RowKind`, `AgentRow`, `Card`, view schemas | | ✅ — **views are the board's** |
| `FLEET_CONTROLS_DEFAULT`, board config | | ✅ |

**The split is the design's own rule**: views *reference* domain objects and do
not copy them. A `Card` is how the board renders a plan; a `Plan` is what a
plan is. **Only the second kind moves.**

### The rules join the entities they are about

**Moving types alone would leave the rules where they are** — and the rules are
what the domain is for. Three land with their entities:

| rule | from | the trap it must keep |
|---|---|---|
| `deliverable` | `board.ts:707 allWavesMerged` | the three-valued `unknown` |
| `eligible` | slice verdicts | prior slices merged, deferred excluded |
| `reapable` | `plot-reap.sh`'s five refusals | `mergedAt`, **never** `state` |

**`allWavesMerged` moves rather than being reimplemented**, for the same reason
the types do: it is already correct, already tested 25 times, and already pure —
it takes a pulse and a boolean and returns a verdict.

### Test-first, and the coverage number is a gate

**Every rule and transition is written test-first.** Not as a preference — the
domain is the one part of Plot where TDD is *possible without friction*, because
a domain object needs no repository, no host and no process to construct. **The
absence of that friction is the whole point of the layer**, and writing the
tests second would waste the property the design was built for.

**The order is explicit per unit:**

1. a failing test naming the rule and one reading it must refuse
2. the smallest implementation that passes
3. the next reading, until every branch of the rule is named by a test

**Coverage is enforced, not reported:**

```
coverage: { thresholds: { lines: 100, branches: 100, functions: 100 } }
```

**100% is defensible here and nowhere else in this repo.** The board cannot
reach it — it spawns processes, binds ports and drives a browser, and a
threshold it structurally cannot meet is one that gets lowered until it means
nothing. **The domain has no such excuse**: the purity gate guarantees every
line is reachable from a plain function call, so an uncovered line is a line
nobody specified.

**That makes the number a gate rather than a target.** *"Is this well tested?"*
is answerable by recollection; *"does `vitest --coverage` exit non-zero?"* is
not.

**It needs `@vitest/coverage-v8`, which this repo does not have** — measured
2026-08-28, no coverage tooling exists anywhere in the workspace. It lands in
the first branch, pinned to the vitest already in use (`^4.1.10`), as a
devDependency of the domain package alone. **The board's threshold is not
changed by this plan**, and proposing one would be a different argument.

**The moved code is the exception, and it is a deliberate one.** `allWavesMerged`
and the pulse schemas arrive with tests already written — 25 for the rule, 53
importers exercising the shapes. **Re-deriving them test-first would be
theatre**: the tests exist, they pass unedited, and that is a stronger proof
than tests written after the fact by the person moving the code. TDD binds what
this plan *writes*, not what it *relocates*.

### What proves the move is correct

**The board's existing tests, passing unedited.** That is the whole bar, and it
is a stronger one than the corpus comparison the earlier draft proposed.

**A corpus test compares two implementations. After a move there is only one** —
the board imports what the domain defines — so a comparison would compare a
thing to itself. What can still be wrong is that the move *changed* something,
and the 53 importers plus the existing suite are precisely the detector for
that.

**A test that needs editing to pass is the failure signal.** Not a nuisance to
fix — a report that the move altered behaviour. Any edit needs an argument in
the PR, not a patch.

> **The earlier draft's "158 of 158" was unreachable and is dropped.**
> `allWavesMerged` takes a `FleetPulse`, and a pulse holds the scan's rolling
> window — **35 plans in the captured pulse**, never the full 158. The number
> asserted something the test could not reach.

## Waves

### Moving (Branch: feature/the-domain-package-exists)

The package, the purity gate, and the entity graph moved out of
`contract/schema.ts`: `FleetPulse`, `FleetPlan`, `FleetWave`, `FleetBranch` and
their zod schemas. The board re-exports from `@plot-pm/domain` so its 53
importers keep their import paths unchanged.

**Done when** the purity grep is empty, `pnpm run test:board` and
`pnpm run typecheck` pass **with no test edited**,
`grep -rn "FleetPulseSchema = " packages/board/` returns nothing, and
`@vitest/coverage-v8` is wired with the 100% threshold failing the build when
unmet.

### Deliverable (Branch: feature/one-deliver-rule-decides-in-the-domain)

`allWavesMerged` moves to `rules/deliverable.ts` with its 25 tests. The board's
three call sites import it.

**Done when** the 25 tests pass unedited from the domain package, and
`board.ts` no longer defines the function.

### Entities (Branch: feature/the-entities-carry-their-states)

The entities the pulse does not carry — PR, Build, Release, Worktree, Agent,
Machine, Issue, Story, Sprint, Person — each with the identity kind and state
source [its spec records](../stories/the-master-agent-holds-the-fleet/DESIGN-entities.md),
and `PortResult<T>` from
[Ports §2b](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#2b-the-pattern-how-a-port-is-recognised).

**Wave has no source of truth** — it is formed at dispatch and persisted
nowhere — so it lands as a type with no constructor, which is the honest shape
until the plan that builds it.

**Done when** every entity is constructible in a test with no fixture file, the
design's cardinality diagram is expressible in the types, and
`vitest --coverage` reports 100% for `src/entities/` with the threshold
enforced in config.

### Transitions (Branch: feature/a-transition-is-one-value)

`plan.approve()`, `plan.deliver()`, `plan.release()` — returning what should be
written rather than writing it.

**This fixes a measured defect**: a phase flip without its record made a
delivered plan invisible to the scan, reporting zero. Today the pairing is a
rule four call sites must remember; here it is one value that cannot come apart.

**Done when** a transition's output is assertable as a value, no transition can
produce a phase without its record, and coverage of `src/transitions/` is 100%
with every refusal branch reached by a named test.

## Notes

**The board is a live surface and this changes what it imports.** Every branch
rebuilds the artifact (`pnpm build:board`) and runs `pnpm run test:board`; a
stale artifact fails reassuringly and reads exactly like the change not working.

**Import paths stay stable on the first branch**, deliberately. Re-exporting
from `contract/schema.ts` means 53 files are untouched while the definitions
move, so the diff is the move and nothing else. Collapsing the re-exports is a
later, separable change.

**Run the e2e tier with `env -u PLOT_UNATTENDED`** — the worker environment
trips the control tests when these run from inside a dispatched worktree.

## Open Questions

- [ ] [Technical] Do the board's re-exports get collapsed, and when? Leaving
  them permanently means two import paths for one type; collapsing them touches
  53 files for no behaviour change. Not urgent, and not this plan's.
- [ ] [Technical] Does `@plot-pm/domain` publish to npm, or stay private to the
  workspace? The board publishes; a domain package that ships is a public API
  Plot then owes compatibility to. — *deferred: decide before the first release
  that would include it*
