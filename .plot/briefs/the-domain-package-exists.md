## Implementation brief — the-domain-moves-out-of-the-board (slice 1: Moving)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-moves-out-of-the-board.md` on `main`
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `feature/the-domain-package-exists` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI `validate` + review)

**This slice unblocks the other three.** `Deliverable`, `Entities` and
`Transitions` all read `blocked` in the fleet scan and become eligible only when
this merges — they import what this creates. Do not widen scope into them.

### What to build

A new workspace package `@plot-pm/domain` that carries Plot's entity graph, and
a board that **imports it rather than defining it**.

Move out of `packages/board/src/contract/schema.ts` — **4,075 lines, verified
2026-08-29** — these four and their zod schemas:

| type | currently at |
|---|---|
| `FleetBranchSchema` | `schema.ts:1444` |
| `FleetWaveSchema` | `schema.ts:1838` |
| `FleetPlanSchema` | `schema.ts:1844` |
| `FleetPulseSchema` | `schema.ts:1866` |

**The board re-exports them from `@plot-pm/domain`**, so its **53 importers**
(verified: `grep -rl "contract/schema" packages/board/src`) keep their import
paths **unchanged**. This is the property that makes the move cheap — if you
find yourself editing import sites, stop and reconsider.

`pnpm-workspace.yaml` already globs `packages/*`, so a new directory is picked
up with no manifest edit.

### The decisions the plan settles — do not re-derive them

**It is a MOVE, not a parallel build.** An earlier draft proposed building fresh
entities *beside* the pulse types and proving agreement with a corpus test. That
was rejected because it creates a **third** implementation of shapes that
already exist twice, and then needs a later plan to remove it. A move creates no
duplication, so there is no window in which two answers exist. **If you find
yourself writing an adapter between old and new shapes, the design has gone
wrong** — say so rather than building it.

**`contract/schema.ts` is already a pure domain layer.** Measured: one import
(`zod`), no disk, no process, no network. That is *why* this is a move and not a
rewrite — the purity already holds, and the gate below only pins it.

**The pulse contract does not change.** Same shapes, same zod, resolved from a
different package. `FleetPulse` is validated at exactly one place
(`pulse-bridge.ts:201`) and that stays true.

**Views stay in the board.** `RowKind`, `AgentRow`, `Card` and the view schemas
are the board's own and do **not** move. The plan's table marks them ✅ *"views
are the board's"*.

### Done when

The plan's `## Done when` for this slice is the specification:

- the purity grep is empty
- `pnpm build:board`, `pnpm run typecheck`, `pnpm run test:board` all pass
  **with no test edited** — the client's single-file bundle included
- `grep -rn "FleetPulseSchema = " packages/board/` returns nothing
- `@vitest/coverage-v8` is wired with a **100% threshold that fails the build**
  when unmet

**"With no test edited" is the load-bearing clause.** The existing tests are the
proof that behaviour is preserved; a test you had to change is a behaviour you
changed. If a test genuinely must move (because its subject moved), say so
explicitly in the PR rather than editing quietly.

**The coverage threshold must FAIL the build.** A threshold that reports and
does not fail is a number nobody reads — this repo's own lesson about detection
reporting into a void.

Plus the repo's gates: Node 24 (`nvm use`; pnpm crashes on 26 — use
`corepack pnpm`), `pnpm build:board` committed, a changeset with its `bumps`
block, never edit versions by hand, `trash` not `rm`.

**The changeset is `'@plot-pm/board': patch` plus a bumps block if any skill
changes.** A new package may need its own entry — check `.changeset/` history
for the shape rather than inventing one.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's
  `## Branches` section **on main** (check `git branch --show-current` first).
- Run tests in the FOREGROUND — a `-p` run has no next turn, so a background
  job's completion never reaches you and the work is stranded uncommitted.

### Scope guard

**This branch owns:** the new `packages/domain/` tree, and the parts of
`packages/board/src/contract/schema.ts` that hold the four Fleet types.

**Verified in flight 2026-08-29 — files other branches hold that you may touch:**

- `bug/a-dead-fetch-is-not-a-slow-one` holds `packages/board/src/app/App.tsx`
  and several `app/components/*` — you should not need these at all.
- `bug/a-claim-is-a-list-item` holds `skills/plot/scripts/plot-plan-meta.sh` —
  out of your scope.
- **213 branches are in flight.** Nobody else holds `contract/schema.ts` right
  now, which is why this slice is dispatchable — but rebase early and often.

**A board artifact conflict is mechanical:** take either side of
`board-server.mjs`, run `pnpm build:board`, commit. Never read its diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope. If the design itself looks wrong — see the plan's
*"When to stop rather than continue"* — stop and say so.
