---
'plot': minor
---

Plot's domain leaves the board and becomes `@plot-pm/domain`.

Four slices, delivered as `the-domain-moves-out-of-the-board`:

- **the package exists** — the entity graph moves out of `contract/schema.ts`
  as a move, not a copy, so no second implementation exists at any point
- **one deliver rule decides in the domain** — `allSlicesMerged` lives with the
  entities it reasons about, and the board imports it
- **the ten entities carry their states** — PR, Build, Release, Worktree, Agent,
  Machine, Issue, Story, Sprint and Person, each with the identity kind and
  state source its spec records, plus `PortResult<T>`
- **a transition is one value** — `plan.approve()`, `.deliver()` and `.release()`
  return what should be written and write nothing, each checking its own
  precondition

Alongside it, `the-domain-speaks-slices` made the code say what the design says:
a **Slice** holds one branch and belongs to one plan; a **Wave** is the fleet's
cross-plan cohort, and now has a type of its own.

**Why minor rather than patch.** Each slice was a patch on its own — no board
behaviour changed and nothing external broke. Together they add a package and
rename a core concept, which is a larger claim than the sum of its parts. The
sprint declared 2.12.0 for exactly this reason, and the release gate reads that
declaration.
