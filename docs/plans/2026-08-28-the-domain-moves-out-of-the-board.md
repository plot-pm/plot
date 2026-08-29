# The domain moves out of the board

> Plot's entities already exist — as `FleetPulse`'s `plans[] → waves[] → branches[]` in `contract/schema.ts`, a 4,052-line module whose only import is zod. This **moves** that graph into `@plot-pm/domain` and adds the rules and transitions the design specifies. A move, not a copy: no duplication is created, and the entities arrive already exercised by 53 importers.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Started:** 2026-08-29, Jan Wloka, `feature/the-domain-package-exists`
- **Started:** 2026-08-29, Jan Wloka, `feature/one-deliver-rule-decides-in-the-domain`

## Approval

- **Assignee:** Jan Wloka

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

**A package, not a directory — and the boundary is the whole reason.**
`contract/schema.ts` is already pure, so `src/domain/` inside the board would
satisfy the same grep. **What it would not do is make the dependency direction
enforceable**: a directory can import `../server/fleet.js`, and eventually
something will. A package cannot — the module resolver refuses, with no grep to
run and no reviewer to notice. **That is the difference between a gate and a
rule**, and this repo's own doctrine says to prefer the gate.

**It is `private: true`, and nothing is lost.** Measured: the board declares
zero runtime dependencies and ships three files; zod is a devDependency esbuild
inlines into the 1 MB artifact. A workspace package bundles identically, so the
published board is byte-for-byte unaffected by where the domain lives —
**the boundary is bought for free.**

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

**The moved code is exempt from writing tests FIRST, and from nothing else.**
`allWavesMerged` and the pulse schemas arrive with tests already written — 25
for the rule, 53 importers exercising the shapes — and re-deriving those
test-first would be theatre: they exist, they pass unedited, and that is a
stronger proof than tests written afterwards by the person doing the move.

**The coverage threshold still applies to it.** If the move reveals uncovered
branches in `allWavesMerged`, those are branches nobody ever specified, and the
slice writes tests for them before merging. **An exemption from ordering is not
an exemption from the gate** — a permanently uncovered region inside a package
whose entire claim is that it is fully testable would make the number
decorative.

**Measure before assuming there is work here.** Running coverage on the moved
code is the first act of the slice; if it is already at 97% the gap closes in
minutes, and if it is far lower that is itself a finding about code the board
has trusted for months.

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

### A parse failure stops looking like a missing file

**Today they are indistinguishable.** `pulse-bridge.ts:201` calls
`FleetPulseSchema.parse()`, which throws, and the surrounding `catch` returns
`null` — the same `null` an absent file produces. **A corrupt pulse reads as
no pulse**, and a board with no pulse shows `unknown` everywhere, which looks
like a cold start rather than a broken payload.

**This is fixed as part of the move, not after it.** The schema is being
relocated and its one validation site is being touched anyway; leaving a known
defect in the code being moved means the move preserves it deliberately.
`safeParse` replaces `parse`, and the two outcomes separate:

| | today | after |
|---|---|---|
| file absent | `null` | **a legitimate empty answer** |
| file unparseable | `null` | **`failed`, with the reason** |

> **This is a behaviour change inside a move, and that is a real cost** — it
> makes the slice's diff more than the move. It is accepted because the
> alternative is a `PortResult` contract in plan 2 whose first consumer already
> collapses the distinction it exists to preserve.

### The slices are strictly sequential, and that is a choice

**Each slice waits for the one before it, and only the first two have to.**
`board.ts` imports `contract/schema.ts`, so moving `allWavesMerged` (slice 2)
sits on top of moving the schema (slice 1). Slices 3 and 4 add new files and
touch neither — **they could run beside slice 2 and are deliberately not
allowed to.**

**Slice 1 is a tracer bullet.** Its job is to answer *does moving a type out of
this module work at all* — against 53 importers, a bundled server build and a
single-file client build. **Cutting three branches on top of an unproven answer
is how a wrong answer becomes expensive**, and the throughput bought by
parallelising is small next to that.

**The ordering also protects a live surface.** Every slice here changes what the
board imports; two agents landing on it in one window makes a regression harder
to attribute.

## Waves

### Moving (Branch: feature/the-domain-package-exists, PR: #509)

The package, the purity gate, and the entity graph moved out of
`contract/schema.ts`: `FleetPulse`, `FleetPlan`, `FleetWave`, `FleetBranch` and
their zod schemas. The board re-exports from `@plot-pm/domain` so its 53
importers keep their import paths unchanged.

**Done when** the purity grep is empty, `pnpm build:board`,
`pnpm run typecheck` and `pnpm run test:board` all pass **with no test
edited** — the client's single-file bundle included,
`grep -rn "FleetPulseSchema = " packages/board/` returns nothing, and
`@vitest/coverage-v8` is wired with the 100% threshold failing the build when
unmet.

### Deliverable (Branch: feature/one-deliver-rule-decides-in-the-domain, PR: #511)

`allWavesMerged` moves to `rules/deliverable.ts` with its 25 tests. The board's
three call sites import it.

**Done when** the 25 tests pass unedited from the domain package, `board.ts` no
longer defines the function, and coverage of `rules/deliverable.ts` meets the
threshold — any gap the move exposes is closed here.

### Entities (Branch: feature/the-entities-carry-their-states, PR: #515)

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

**Each returns `Decision | Refusal`, and checks its own precondition.** The
design's rule is that a STATED state can be wrong — *a file can say `Approved`
when nobody approved* — **so transitions are gated**, and a gate a caller can
skip is a rule rather than a gate.

`plot-approve.sh` already has this shape: it refuses on the phase, on the review
channel, and on the PR state before writing anything, and it names which
refusal fired. **The domain transition carries those same refusals** — the
mechanical ones. What it cannot carry is the PR check, which needs a host: that
stays a precondition the adapter supplies as a reading.

**The separation is deliberate and narrow.** `approvable(plan)` remains callable
alone — the board's Approve button needs to know whether to *offer* the action
before anyone takes it — but `approve()` does not trust that anyone called it.

**This fixes a measured defect**: a phase flip without its record made a
delivered plan invisible to the scan, reporting zero. Today the pairing is a
rule four call sites must remember; here it is one value that cannot come apart.

**Done when** a transition's output is assertable as a value, no transition can
produce a phase without its record, **every refusal is individually triggerable
by a named test**, and coverage of `src/transitions/` is 100%.

## Notes

### If a moved rule is subtly wrong, the scan is what says so

**The existing tests prove behaviour is preserved; they cannot prove it is
right.** A rule that was wrong before the move is wrong after it, and unedited
tests will happily agree.

**`plot-reconcile-scan.sh` is the independent check**, and it is independent for
a reason worth stating: **its section 2 derives merged-ness from git and from
merged PR heads — never from `allWavesMerged`.** So a plan the domain calls
undeliverable while its branches have in fact merged appears there as
`merged_not_delivered=N`, on the existing cadence, computed by code this plan
does not touch.

**No new mechanism, and deliberately not a dual-path assertion.** Computing the
verdict both ways and logging mismatches would reintroduce the second
implementation the move exists to remove — and a temporary second
implementation is how a permanent one starts.

**The board is a live surface and this changes what it imports.** Every branch
rebuilds the artifact (`pnpm build:board`) and runs `pnpm run test:board`; a
stale artifact fails reassuringly and reads exactly like the change not working.

**Import paths stay stable on the first branch**, deliberately. Re-exporting
from `contract/schema.ts` means 53 files are untouched while the definitions
move, so the diff is the move and nothing else. Collapsing the re-exports is a
later, separable change.

**That is a reviewability choice, not a rollback mechanism.** The move is
proven before merge the way any change is: `pnpm build:board` **and**
`pnpm run typecheck` **and** `pnpm run test:board` green on the branch. Two
builds must both be exercised — the server bundles (`bundle: true`) and the
client inlines to a single file (`vite-plugin-singlefile`), and a workspace
package that resolves for one can still fail the other. **A green server build
is not evidence about the artifact the browser loads.**

**Run the e2e tier with `env -u PLOT_UNATTENDED`** — the worker environment
trips the control tests when these run from inside a dispatched worktree.

### When to stop rather than continue

**The done-when clauses say when a slice is finished. This says when the design
is wrong.**

**If the purity gate cannot be satisfied — stop, and take it back to the
design.** A moved rule that genuinely needs to reach a disk, a host or a process
means the domain/adapter line is drawn in the wrong place, and no amount of
patching the slice fixes a boundary that is mis-drawn. **That is a design
failure, not a coding one**, and the response is a finding in
[DESIGN-ports.md](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md),
not a `// eslint-disable`.

**It halts the other two plans as well.** Both rest on the same boundary, and
they are Draft precisely so this can happen — a design that fails its first
real contact should not have two approved plans behind it.

**Tests needing edits is the weaker signal and is handled inside the slice.** It
means the move altered behaviour, which is usually a mistake in the move rather
than in the design — the edit needs an argument, not a halt.

## Open Questions

- [ ] [Technical] Do the board's re-exports get collapsed, and when? Leaving
  them permanently means two import paths for one type; collapsing them touches
  53 files for no behaviour change. Not urgent, and not this plan's.
- [x] [Technical] Does `@plot-pm/domain` publish to npm? **No — `private: true`,
  and nothing is lost by it.** Measured: `@plot-pm/board` declares **zero**
  runtime dependencies and ships three files (`dist/board-server.mjs` plus two
  shell scripts); zod is a *devDependency* that esbuild inlines into the 1 MB
  artifact. A workspace package is bundled the same way, so the published board
  is byte-for-byte unaffected by where the domain lives. **Publishing would only
  create a public API Plot then owes compatibility to** — a cost with no
  matching benefit, since no external consumer exists.
