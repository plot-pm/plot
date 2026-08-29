## Implementation brief — the-domain-moves-out-of-the-board (slice 2: Deliverable)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-moves-out-of-the-board.md` on `main`
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `feature/one-deliver-rule-decides-in-the-domain` (base: `main`)
- **Ends as:** one PR to `main`
- **Depends on:** slice 1 (`the-domain-package-exists`, #509) — merged. `@plot-pm/domain` exists.

Independent of slices 3 (`Entities`) and 4 (`Transitions`). All three became
eligible together; none imports another.

### What to build

Move `allWavesMerged` from `packages/board/src/server/board.ts:707` into
`@plot-pm/domain` as `rules/deliverable.ts`, and have the board import it.

```ts
export function allWavesMerged(
  meta: PlanMeta, pulse: FleetPulse | null, complete: boolean,
): Landed        // 'merged' | 'not-merged' | 'unknown'  — board.ts:705
```

**Take `Landed` with it.** It is the rule's return type and means nothing
without it.

### Numbers in the plan that I re-measured, and they differ

The plan says *"with its 25 tests. The board's three call sites import it."*
**Measured 2026-08-29 — check for yourself rather than trusting either of us:**

| plan says | actually |
|---|---|
| 3 call sites | **4** non-test call sites (`deliver.ts` ×2, `auto-deliver.ts`, plus the definition's own module) |
| 25 tests | the tests are spread over **four** files: `merged-waves-reach-testing.test.ts` (15 in file, the dedicated one), plus `auto-deliver.test.ts`, `deliver-route.test.ts`, `plan-status.test.ts` which exercise it indirectly |

**This does not change the work; it changes what "done" looks like.** Do not
hunt for a file with exactly 25 tests in it. `tsc` names every call site — that
is the reliable count.

### The decisions the plan settles — do not re-derive them

**A MOVE, not a re-implementation.** Same rule as slice 1: no second
implementation exists at any point. If you find yourself writing an adapter, or
leaving a thin wrapper in `board.ts` that re-derives anything, stop — a wrapper
that only re-exports is fine, a wrapper that decides is the defect.

**The existing tests prove behaviour is preserved; they cannot prove it is
right.** A rule that was wrong before the move is wrong after it. Do not "fix"
a surprising case you find — report it.

**Coverage is a gate here, and it will actually bite.** Unlike slice 1 (zod
declarations: 8 statements, 0 branches), this is a real function with branches.
The domain package's threshold is 100% and **fails the build** when unmet, so
*"any gap the move exposes is closed here"* — the plan's words. Expect to write
tests, not just move them.

### Done when

The plan's `## Done when` for this slice:

- the tests pass **unedited** from the domain package
- `board.ts` **no longer defines** the function
- coverage of `rules/deliverable.ts` meets the 100% threshold

**"Unedited" is load-bearing.** A test you had to change is a behaviour you
changed. Import-path updates are not behaviour; anything else is, and belongs in
the PR body explicitly.

Plus the repo's gates: Node 24 (`nvm use`; use `corepack pnpm`, homebrew pnpm
crashes), `pnpm build:board` committed, `pnpm run typecheck`, `pnpm run
test:board`, a changeset naming `'@plot-pm/board'` and `'@plot-pm/domain'`.

### One thing you will notice and should NOT fix

The domain calls a slice a `Wave` — `FleetWaveSchema`, `WaveVerdict`,
`plan.waves`. **That is a known, documented defect** with its own plan
(`docs/plans/2026-08-29-the-domain-speaks-slices.md`) and a comment at the
schema explaining it. The function you are moving is named `allWavesMerged` for
the same reason.

**Keep the name.** Renaming it here fuses two changes and breaks the rename
plan's own sequencing. Read `Wave` as `Slice` and move on.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  in the plan's `## Waves` section **on main** — the form is
  `### Deliverable (Branch: x, PR: #N)`, not a trailing arrow.
- Run every test in the FOREGROUND. A `-p` run has no next turn, so a background
  job's completion never reaches you and finished work is stranded uncommitted.

### Scope guard

**This branch owns:** `packages/domain/src/rules/deliverable.ts` (new), the
`allWavesMerged` definition in `packages/board/src/server/board.ts`, and the
import lines at its call sites.

**Two sibling branches are in flight from the same plan** —
`feature/the-entities-carry-their-states` and `feature/a-transition-is-one-value`.
Both add NEW files under `packages/domain/src/`; none of you should be editing
another's. If you need to touch `packages/domain/src/index.ts`, expect a trivial
conflict there and rebase rather than reverting.

**A board artifact conflict is mechanical:** take either side of
`board-server.mjs`, run `pnpm build:board`, commit. Never read its diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
