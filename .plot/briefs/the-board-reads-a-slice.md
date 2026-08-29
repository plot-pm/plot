## Implementation brief — the-domain-speaks-slices (slice 2: Speaking)

- **Plan (canonical):** `docs/plans/2026-08-29-the-domain-speaks-slices.md` on `main`
- **Approved:** 2026-08-29, Jan Wloka, in-session
- **Branch:** `infra/the-board-reads-a-slice` (base: `main`)
- **Ends as:** one PR to `main`
- **Waits on:** slice 1 (`infra/the-domain-names-a-slice`) landing first — it
  creates the names you consume and the aliases you remove.

### What to build

Move the board's call sites from `plan.waves` to `plan.slices`, and **remove the
compatibility aliases** slice 1 left in `packages/board/src/contract/schema.ts`.

**Purely mechanical, and `tsc` is the gate** — the compiler names every site
that has not moved. Do not hunt by grep and hope.

The plan counted **44** call sites reading `.waves` when it was written. Trust
`tsc`'s list over that number; slice 1 may have shifted it.

### The decisions the plan settles — do not re-derive them

**The aliases were always a bridge with an end date.** They exist so slice 1
could change the schema without touching 44 call sites in the same diff. This
branch is the end date. Leaving one behind means two vocabularies for one
entity, which is the defect the whole plan removes.

**Do NOT touch the scan's output.** `plot-fleet-scan.sh` still emits `"waves"`,
and step 2 of the migration — the producer switching to `"slices"` — is
deliberately out of scope with its own timing decision. The schema reads both;
that is what makes this branch safe. **A branch that edits the emitter has
widened past its plan.**

### Done when

Per the plan:

- **no alias remains** — `grep` for `FleetWaveSchema`, `FleetWave`,
  `WaveVerdict` and `.waves` under `packages/board/src/` returns nothing outside
  a compatibility shim's own test, if one exists
- the board suite passes with **no test edited** beyond the renames themselves
- `pnpm run typecheck` is clean

**"No test edited beyond the renames" is load-bearing.** A test whose
*assertions* changed is a behaviour that changed. Renaming an identifier inside
a test is a rename; changing what it expects is not, and belongs in the PR body
with an argument.

Plus the repo's gates: Node 24 (`nvm use`, `corepack pnpm`), `pnpm build:board`
committed, a changeset naming `'@plot-pm/board'`.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Speaking (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn.

### Scope guard

**This branch owns:** the `.waves` call sites across `packages/board/src/` and
the alias block in `contract/schema.ts`.

**The board suite is load-flaky on two files** — `streaming-scan.test.ts` and
`auto-dispatch-spawn.test.ts` fail under full parallel load on `main` too. Run
them alone before believing a failure, and baseline against a pristine `main`
worktree rather than assuming your rename caused it.

**A board artifact conflict is mechanical:** take either side of
`board-server.mjs`, run `pnpm build:board`, commit. Never read its diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
