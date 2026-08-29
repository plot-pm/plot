## Implementation brief — the-domain-speaks-slices (slice 1: Reading)

- **Plan (canonical):** `docs/plans/2026-08-29-the-domain-speaks-slices.md` on `main`
- **Approved:** 2026-08-29, Jan Wloka, in-session
- **Branch:** `infra/the-domain-names-a-slice` (base: `main`)
- **Ends as:** one PR to `main`

**This slice unblocks the rest of the domain work.** `the-domain-moves-out-of-the-board`'s
remaining slices are paused until the vocabulary is right — PR #511 was closed
green rather than merged, precisely so nothing further is built on the wrong word.

### What to build

Rename inside `@plot-pm/domain`, and teach the schema to read either spelling
off the wire:

| now | becomes |
|---|---|
| `FleetWaveSchema` / `FleetWave` | `FleetSliceSchema` / `FleetSlice` |
| `WaveVerdictSchema` / `WaveVerdict` | `SliceVerdictSchema` / `SliceVerdict` |
| `FleetPlanSchema.waves` | `FleetPlanSchema.slices` |

**The board keeps compiling unchanged**, via re-exports from
`packages/board/src/contract/schema.ts`:

```ts
export { FleetSliceSchema as FleetWaveSchema, type FleetSlice as FleetWave };
```

**The wire accepts BOTH.** `plot-fleet-scan.sh` still emits `"waves"`, and it is
a separate process that ships separately — so the schema reads `slices` when
present and falls back to `waves`, normalizing to `slices`. A new board must
work against an old scan.

### Why this is the shape — do not re-derive it

**A Slice holds one branch and belongs to one plan. A Wave is the fleet's
cohort** — it spans plans, is sized by the agents available, is formed at
dispatch and is **persisted nowhere** ([DESIGN-slice.md](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md)).
The object you are renaming holds `branches[]` and sits in `plan.waves[]`: a
Slice by every property.

**Do NOT rename the scan's output in this branch.** Step 2 of the migration
(the producer emitting `"slices"`) is deliberately out of scope and has its own
timing decision — a branch that touches the emitter has widened past its plan.

**Do NOT touch the board's 44 call sites.** That is slice 2 (`Speaking`), and it
is separated so the schema change and the call-site churn can be reviewed as
distinct claims.

**Do not rename `allWavesMerged`.** It lives in the board today (PR #511 was
closed), and it is slice 2's business.

### House rules for this package — all three are CI-gated

`CLAUDE.md` › **The Domain Package**:

1. **Arrow functions.** `export const f = (…) => …`. A `function` declaration
   under `packages/domain/src/` fails the build.
2. **Factual API docs.** TSDoc says what an export does, its parameters, its
   return, its failure modes. Reasoning goes in the plan and the commit message
   — dated, and findable with `git log -S`. The measured problem: 28 lines of
   code under 109 lines of comment.
3. **Vocabulary.** A gate counts `wave` occurrences under `packages/domain/src/`
   and fails on an **increase** over the current allowance. **This branch should
   drive that number down** — lower the `allowed=` value in
   `.github/workflows/ci.yml` to whatever remains, so the gate keeps its grip.
   The comment that explains what a Wave *will* be is the legitimate remainder.

### Done when

Per the plan's `## Done when`, the clauses this slice owns:

1. **`@plot-pm/domain` contains no identifier named `Wave`** — except in the
   comment explaining what a Wave will be when the fleet learns to form cohorts.
2. **A pulse in either spelling parses to the same object.** Assert on *both*
   inputs — a test that feeds one and claims the other is the failure this
   clause exists to prevent.
3. **The scan still emits `waves`** — verify you did not touch it.
4. `pnpm run typecheck`, `pnpm run test:board`, and the domain's 100% coverage
   gate stay green, with **no board test edited**.

Plus the repo's gates: Node 24 (`nvm use`, `corepack pnpm`), `pnpm build:board`
committed, a changeset naming `'@plot-pm/board'` and `'@plot-pm/domain'`.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Reading (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn, so a background
  job's completion never reaches you and finished work is stranded uncommitted.

### Scope guard

**This branch owns:** `packages/domain/src/**` and the re-export block in
`packages/board/src/contract/schema.ts`.

**The board suite is load-flaky on two files** — `streaming-scan.test.ts` and
`auto-dispatch-spawn.test.ts` fail under full parallel load on `main` too. If
you see failures there, run those files alone before believing them, and
baseline against a pristine `main` worktree rather than assuming.

**A board artifact conflict is mechanical:** take either side of
`board-server.mjs`, run `pnpm build:board`, commit. Never read its diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
