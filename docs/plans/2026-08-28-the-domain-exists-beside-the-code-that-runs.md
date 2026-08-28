# The domain exists beside the code that runs

> A new `@plot-pm/domain` package holding Plot's fourteen entities, their states and the rules that gate their transitions — built and tested to completion **beside** the production code, replacing none of it. Nothing in `packages/board` or `skills/plot/scripts/` changes.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A new `@plot-pm/domain` package carries Plot's domain model — entities, states, transitions and the port interfaces — with no dependency on git, the filesystem, a host CLI or a process table.

<!-- Board impact: NONE, by construction. This plan adds a package and changes
     nothing the board reads or runs. The board keeps its own copies of every
     rule until a later plan replaces them, and this plan does not. -->

## Motivation

**The design is finished and nothing implements it.** Seventeen documents in
`docs/stories/the-master-agent-holds-the-fleet/` specify fourteen entities,
their identity kinds, their state sources, their cardinalities, seven driven
ports and the pattern every port follows. **No code corresponds to any of it.**

**The measured problem it exists to fix**: 34 of the board's 77 unit tests
touch disk or spawn a process (44%). A test of the *deliver rule* — *is every
non-deferred branch merged?* — currently writes a `docs/plans/` tree and shells
out to a parser to ask a question that is a predicate over a Plan.

**Why parallel rather than extracted.** The obvious move is to extract
`allWavesMerged` from `board.ts` and have both entrances call it. That move
risks the working system to build the new one: every extraction step leaves the
board temporarily depending on a module that is half-designed, and a mistake
lands on a board somebody is watching.

**Building beside it inverts the risk.** The domain is complete and green
before anything calls it, so the first replacement is a swap of a proven
implementation for a proven implementation, not a migration. **The cost is a
period of genuine duplication** — two implementations of rules that already
exist twice today, so three — and that cost is bounded by this plan being
followed by the plans that remove it.

> **The duplication is deliberate and temporary, and it must be named as such
> in the code.** [Stage 2 §5](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
> establishes that a copy re-implementing a decision may not stand. This package
> is exactly that copy, licensed only by its removal being planned.

## Design

### Approach

**A new workspace package, `packages/domain`, published as `@plot-pm/domain`.**
`pnpm-workspace.yaml` already globs `packages/*`, so no workspace change is
needed, and `check-changeset-packages.sh` derives valid names from the
workspace rather than a hardcoded list — a new package is accepted the day it
exists.

**It has zero runtime dependencies**, matching `@plot-pm/board`, which has none
either. Zod is a devDependency there and stays out of the domain: a schema
library is a *parsing* concern and parsing happens in adapters.

```
packages/domain/
  src/
    entities/       Plan, Slice, Branch, PR, Build, Release,
                    Worktree, Agent, Machine, Issue, Story,
                    Sprint, Person, Wave
    ports/          one file per port — interfaces only
    rules/          the predicates: deliverable, eligible, reapable, …
    transitions/    approve, deliver, release — returning what to write
  test/
```

**No `adapters/` directory in this plan.** An adapter reaches the world, and
this plan builds nothing that does. The port *interfaces* land here because
the rules are typed against them; their implementations are the next plan's.

### The gate that makes "no external dependency" checkable

**The acceptance criterion is a script, not a promise.** A test that *happens*
not to touch disk proves nothing about the next test.

```bash
# fails if any module under src/ reaches the world
grep -rlE "from '(node:|fs|child_process|http|https|net)" packages/domain/src/
```

**Empty output is the gate.** It runs in CI beside `pnpm test`, and it is the
whole reason this package can be trusted to be pure —
[Ports §1](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#1-what-the-domain-is-and-what-it-may-not-import)
argues the form: *"did I keep this pure?"* is answerable by recollection and
therefore worthless; *"does this module's import graph reach `node:fs`?"* is a
script.

**`auto-deliver.ts` already proves this style of gate holds** — its own
invariant is stated as a grep, and it holds today, verified.

### What the rules are ported from, and how they are checked

**Every rule in this package already exists somewhere**, and the existing
implementation is the specification:

| rule | ported from | the trap |
|---|---|---|
| deliverable | `board.ts:707 allWavesMerged` | must keep the three-valued `unknown` |
| eligible | `plot-fleet-scan.sh` slice verdicts | prior slices merged, deferred excluded |
| reapable | `plot-reap.sh`'s five refusals | `mergedAt`, **never** `state` |
| dispatchable | `plot-dispatch.sh`'s four refusals | a live worktree is a measurement |
| approvable | `plot-approve.sh`'s three refusals | Draft **or** Design, not just Draft |

**The board's copy is the one to port where two exist**
([stage 2 §4](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#4-where-the-same-rule-lives-twice)):
it carries the `unknown` third value added after a measured defect, catches
vacuous truth via `merged > 0`, and has 25 tests against the shell's zero.

### Ported is not the same as reimplemented

**A rule is ported when a test proves it agrees with the original.** For the
deliver rule that is checkable exhaustively: run both against this repo's 158
plans and assert identical verdicts, all 158. **A disagreement is a finding
either way** — either the port is wrong, or it found a bug in production.

That corpus test is the honest form of *"we ensure the code works"*: it does
not ask whether the new code passes its own tests, it asks whether it says the
same thing as the code that has been running.

## Waves

### Skeleton (Branch: feature/the-domain-package-exists)

The package, the purity gate, and one entity end to end — **Plan**, because it
is the hub every other entity relates through and its parser contract is the
most exercised. Ships `Plan`, its seven states, `PlanState`, and the
`deliverable` rule with the 158-plan corpus test.

**Done when** the purity grep is empty, `pnpm test` passes in the new package,
and the corpus test asserts 158 of 158 agreements with `allWavesMerged`.

### Entities (Branch: feature/the-entities-carry-their-states)

The remaining thirteen: Slice, Branch, PR, Build, Release, Worktree, Agent,
Machine, Issue, Story, Sprint, Person, Wave. Each with the identity kind and
state source its spec now records, and `PortResult<T>` from
[Ports §2b](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#2b-the-pattern-how-a-port-is-recognised).

**Wave has no source of truth and is specified as forming at dispatch** — it
lands here as a type with no constructor, which is the honest shape until the
plan that builds it.

**Done when** every entity is constructible in a test with no fixture file, and
the cardinalities in the design's diagram are expressible.

### Rules (Branch: feature/the-rules-are-predicates)

`eligible`, `reapable`, `dispatchable`, `approvable` — each ported from its
shell original, each with a corpus test against this repo's real state.

**`Refusal` lands here**, not `PortResult`: a port answers what is *true* and
can fail to know; a rule states what was *decided* and, given readings, is
total.

**Done when** each rule's refusals are individually assertable — five readings
in, five distinct rules named out — with no worktree, no pid and no host.

### Transitions (Branch: feature/a-transition-is-one-value)

`plan.approve()`, `plan.deliver()`, `plan.release()` — returning what should be
written rather than writing it.

**This is the fix for a measured defect**: a phase flip without its record made
a delivered plan invisible to the scan, reporting zero. Today the pairing is a
rule four call sites must remember; here it is one value that cannot come
apart.

**Done when** a transition's output is assertable as a value, and no transition
function can produce a phase without its record.

## Notes

**Nothing in this plan is called by anything.** That is the point and it is
also the risk: an unused package can drift from the production rules it was
ported from. **The corpus tests are what prevent that** — they run against the
live estate every CI run, so a production rule that changes without the port
following it turns CI red.

**Two questions this plan does not answer**, both from
[Ports §9](../stories/the-master-agent-holds-the-fleet/DESIGN-ports.md#9-what-is-unresolved):
whether the domain ships as a package or a bundled artefact, and where the
pulse cache lives. **Neither blocks this work** — both are about how the shell
entrances reach the domain, which is the plan after next.
