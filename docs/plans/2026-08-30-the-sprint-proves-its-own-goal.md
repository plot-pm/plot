# The sprint proves its own goal

> A gate counts what production still holds for itself, and the number only goes down.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

CI counts the rules production still implements itself and the domain names
production still uses, and fails when either grows. Both are ratchets with a
stated target of zero.

## Motivation

### The goal's first condition has no gate, and the plans say so themselves

The sprint goal is three conditions, and *replaced* is the one about removal:

> | **replaced** | production still holds its own copy — the duplication this sprint exists to end |

`production-calls-the-domain-one-rule-at-a-time` states the discipline plainly:

> **One rule per branch, and the branch deletes what it replaces.**
> **Delete the old implementation in the same commit.**

**That is a rule, and CLAUDE.md says what a rule becomes:**

> *A **rule** is a guideline the agent can rationalize around… **The test:** Can
> you answer "Did I complete this?" without actually doing the work? If yes,
> it's a rule. If no, it's a gate.*

*"Did I delete the old copy?"* is answerable without looking. Six slices, each
deleting something, and nothing counting what is left.

### CI has six domain gates and all six look one way

Measured 2026-08-30: purity, port completeness, vocabulary, actor-name,
function-style, coverage. **Nine path references across them, every one
`packages/domain/src`.** Not one looks at `packages/board`, which is where the
old copies live.

**So the estate is protected against a bad domain and unprotected against a
duplicated one** — which is the state the plans call the worst available: three
copies where there were two.

### The vocabulary gate already proves the shape works

```yaml
allowed=10  # 2026-08-29: the entity rename took it 12 -> 10; the target is 0
```

A ratchet with its history in the comment. It cannot be argued with, it records
progress, and **12 → 10 is visible in one line**. This plan asks for the same
instrument pointed at the other side of the seam.

### Measured 2026-08-30: the residue is a name, not a copy

Taking the goal's own example:

```
packages/domain/src/rules/deliverable.ts:62   export const allSlicesMerged = (
packages/board/src/server/board.ts:671        export { allSlicesMerged as allWavesMerged, … }
packages/board/src/server/deliver.ts:231      allWavesMerged(meta, …)
packages/board/src/server/auto-deliver.ts:235 allWavesMerged(joinKey(plan.file), …)
packages/board/src/server/auto-deliver.ts:269 allWavesMerged(joinKey(plan.file), …)
```

**There is no second implementation.** The rule moved; a `TEMPORARY ALIAS`
survived it, and three call sites still say the old word. A grep for duplicated
*code* finds nothing here — which is exactly why the gate must count **names**,
not bodies.

## Design

### The layering rule, stated by the operator and settled 2026-08-30

> **Controllers call the domain. The domain owns a port. The port is implemented
> by an adapter. The adapter calls the script.**
>
> **Scripts can only be called from an adapter implementation.**
>
> **There is no domain-specific code or behaviour that is not implemented by the
> domain.**

**The import direction is what makes this checkable**, and it was verified while
settling it: `machine-system.ts` imports `ports/machine.js`; `ports/machine.ts`
references `adapters/` **zero** times. A port is an `interface` — no runtime
code, nothing to call. The domain *defines* it, the adapter *implements* it, and
the dependency points inward.

**Measured 2026-08-30, and only one half holds:**

```
domain outside adapters/, spawn or execFile      0   ← the purity gate holds it
packages/board/src, spawn or execFile           65   across 23 files
packages/board/src, naming a plot-*.sh          36
```

**So the inner boundary is enforced and the outer one is not.** CI has nine path
references across six domain gates, and **zero** for `packages/board`.

### Two counts, because there are two ways to fail

| count | what it catches | today |
|---|---|---|
| **domain names production still aliases** | a rule moved, its old name kept alive | `allWavesMerged` in `board.ts`, 3 call sites |
| **spawn/execFile outside `adapters/`** | the layering rule broken — a caller reaching past the port | **65 lines, 23 files** |
| **board files reaching the domain** | the other direction: how far adoption has got | 2 of 36 server files |

**The second is the operator's rule made countable.** It does not ask whether a
call is "domain logic" — a judgement no grep can make — but whether anything
outside `adapters/` spawns at all. **That is the same shape as the purity gate**,
which succeeds precisely because it greps imports rather than intent.

**What it cannot catch, stated:** domain-specific *behaviour* implemented in the
board without spawning anything — a rule written in TypeScript in a route
handler. The third condition of the operator's statement covers that, and it is
**not** greppable. It stays a review question, and the alias count is its
closest measurable proxy: a rule that moved leaves a name behind, and a rule
that never moved leaves no trace a gate can see.

**The first is the gate.** It ratchets down and fails on growth, exactly like
the vocabulary gate.

**The second is a report, not a gate.** It rises as work lands, and a threshold
on it would fail the day someone splits a file. Print it; let a human read the
trend.

### The gate counts aliases and re-exports, not implementations

A duplicated rule is easy to imagine and hard to grep. What is greppable, and
what actually happened here, is a **name that outlived its move**: an
`export { x as y }`, an import of the old identifier, a wrapper that forwards.

**So the gate's subject is the seam, not the logic.** That is narrower than
"find duplication" and it is the part that can be enforced.

### Not chosen: a threshold on domain adoption

*"At least N board files must import `@plot-pm/domain`"* fails on a refactor
that merges two files and passes on one that imports without calling. It
measures file layout, not adoption.

### Not chosen: wait until the sprint ends and check by hand

That is the current plan, and it is why the question was asked. A check nobody
has scheduled is a check that happens once, in the release, under time pressure.

## Slices

### Layering (Branch: infra/only-an-adapter-reaches-a-script)

A CI gate counting `spawn`/`execFile` outside `packages/domain/src/adapters/`,
with `allowed` at today's 65 and the target stated as zero.

**Done when** the gate fails if a new direct spawn is added anywhere outside
`adapters/`; it passes on today's estate with the count in its output; and the
failure message names the files, so a reader sees where the layer was crossed.

**It covers both packages deliberately.** The purity gate already stops the
domain from importing `node:child_process`; this one stops the *board* from
reaching past the port — the half that was never enforced.

**Its `allowed` will fall as `production-calls` lands**, and each of that plan's
Spawning slices should take it down. That is the ratchet working as intended:
the gate does not do the migration, it records it.

### Counting (Branch: infra/the-gate-counts-what-production-keeps)

A CI gate counting domain names production still aliases, with `allowed` set to
today's number and the target stated as zero.

**Done when** the gate fails if a new alias is added; it passes on today's
estate with the count in its output; the `allowed` line carries the date and the
number it replaced, as the vocabulary gate's does; and the failure message names
the aliases, not just the count.

**The trap this must not fall into:** counting `allWavesMerged` occurrences
rather than the alias. The three call sites are consequences of one
`export { … as … }`, and a gate that counts consequences goes red on a refactor
that touches call sites without changing the seam.

### Reporting (Branch: infra/the-board-says-how-far-adoption-got)

A CI step printing how many board files reach the domain, **failing on nothing**.

**Done when** the number is in the run's output; no threshold is attached; and
the step's own comment says why it cannot be a gate.

**It is separate from Counting deliberately.** A report and a gate in one step
teaches a reader that the number is enforced, and the next person to see it rise
will assume something is broken.

## Done when

1. A gate fails when production keeps a domain rule's old name.
2. Its `allowed` is a ratchet with a dated history and a target of zero.
3. Adoption is reported and gated on nothing.
4. Both run in CI on every PR.
5. `pnpm test` green; the gate passes on main unchanged.

## Notes

Raised by the operator 2026-08-30: *"how do we make sure that after the sprint
all business functions are covered by the domain, and the old code was removed?"*

The honest answer at the time was: **we do not.** Twelve plans, six domain gates,
and the removal carried by a sentence in one plan's prose.
