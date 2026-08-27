## Implementation brief — the-budget-is-spent-where-it-is-needed (wave: Watched)

- **Plan (canonical):** `docs/plans/2026-08-22-the-budget-is-spent-where-it-is-needed.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/the-board-refreshes-what-is-watched` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**Wave 2 of 3.** `Measured` shipped as **#485** — `plot-host.sh rate-limit`
reports both budgets. `Fallen back` (`feature/the-fallback-asks-the-other-budget`)
follows this wave. The two share no files and cannot collide; the ordering is a
value judgement, argued below.

### What to build

The board's refresh treats every branch alike. A branch whose PR is **merged**,
or whose plan is **delivered**, cannot change in a way anyone is waiting for; a
branch in WORKING or WAITING ON YOU can. Skip the ones that cannot change.

**Why this wave goes first, though the plan's own ordering put the fallback
ahead of it.** That ordering predates a measurement. After #486 landed the scan
batching, the scan reads **24.2 % CPU — 6.61 s of work inside ~24 s wall clock**
on this estate. It is no longer computing; it is waiting on GitHub. Skipping
questions that cannot change is therefore the larger lever today, while the REST
fallback only pays once a budget is genuinely exhausted.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Do NOT add a second cache.** `PLOT_TERMINAL_CACHE` already exists
(`plot-fleet-scan.sh:782`) and applies exactly this reasoning to terminal states
in the scan. This wave extends that idea to the board's own cadence. A second,
differently-shaped cache is how two sources of truth start.

**Do NOT lower the refresh frequency across the board.** That reduces spend
proportionally and makes the board staler for everyone — and staleness is the
defect the board exists to remove. **Spending less per pass beats passing less
often**, the same argument `plot-fleet-scan.sh` already won when it batched.

**The skip is re-derived from git every pass and NEVER persisted.** This is the
difference between a derivation and a record, and it is a listed test. A
persisted verdict is a cache that git cannot invalidate — precisely the thing
the paragraph above rejects.

**Read `mergedAt`, never `state`.** A merged PR reports `state: CLOSED`, and
squash-merge leaves a branch permanently "ahead of main", so ancestry cannot
decide merge state either.

**The board's host consumers are `refreshPrs` and `refreshIssues`**
(`packages/board/src/server/fleet.ts`). The scan is git-only and asks the host
nothing — there is no third caller to throttle, and no scan change belongs in
this branch.

### Done when

The plan's `## Done when` list is the specification. This wave's items:

- **A merged PR is not re-asked across two passes**, counted with a
  **PATH-stubbed CLI that counts invocations** — the technique #228 used. Assert
  the COUNT, not the duration: a timing assertion is flaky and the count is the
  fact that produces it.
- **A WORKING branch IS asked every pass.** The assertion a naive implementation
  passes without: a change that skips everything satisfies the first item and
  makes the board useless. Both items or neither.
- **The skip is re-derived each pass and never persisted.**
- **The rate-limit notice names which budget is spent** — that shipped in #485;
  do not rebuild it, and do not regress it.

Plus the repo's gates: `pnpm test`, `pnpm run test:board` green; **artifact
rebuilt and committed** (`pnpm build:board` from the repo root — from
`packages/board` it is `pnpm build`); a changeset with `'@plot-pm/board': patch`
**package frontmatter** (a board change does NOT use a skills `bumps:` block);
Node 24 (`nvm use`, and `corepack pnpm` — homebrew pnpm runs its own node and
crashes); `trash` rather than `rm`.

Board browser tests load the BUILT artifact — build before running them or you
will test a stale bundle and get reassuring green.

### Bookkeeping

When the PR is created, annotate this branch's line in the plan's `## Branches`
section on main with a trailing `→ #N`. **This plan uses the Branches dialect**
— the arrow form, NOT the `(Branch: x, PR: #N)` heading form. Check
`git branch --show-current` is main first, or use a detached scratch worktree
(`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns the refresh cadence in `packages/board/src/server/fleet.ts` and
its tests. It does **not** touch `plot-host.sh` — that is `Fallen back`'s
territory, and the two branches were sliced apart precisely so they share no
file.

`bug/the-deliver-gate-reads-the-verdicts` and
`feature/a-finished-plan-delivers-itself` are both in flight in
`packages/board/src/server/` — in `board.ts` and `deliver.ts` respectively,
not `fleet.ts`. Rebase onto current main before you start.

Note `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` is a
**tracked fixture** that board test runs rewrite — check `git status` before
committing and never `git add -A` after a suite run.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
