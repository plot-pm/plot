## Implementation brief — a-finished-plan-delivers-and-clears-up (wave: Delivered)

- **Plan (canonical):** `docs/plans/2026-08-27-a-finished-plan-delivers-and-clears-up.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/a-finished-plan-delivers-itself` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**Wave 3 of 4.** `Landed` (#479) and `Extracted` (#483) have BOTH MERGED —
`skills/plot/scripts/plot-deliver.sh` exists on main and is what you call. `Cleared`
(`feature/a-delivered-plan-releases-its-refs`, deleting remote refs after the
reap) follows this wave; do not build it here.

### What to build

When a plan's last non-deferred wave merges, the plan sits at `Approved` with
every branch landed and a worktree per branch still on disk. A person must
notice, run `/plot-deliver`, then reap. Make the board do it: deliver the plan
by calling `plot-deliver.sh`, then reap its worktrees.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The board must NOT write the plan file.** Item 7 asserts this by the ABSENCE
of any phase-flip or `Delivered:` write in `packages/board`. `plot-deliver.sh`
owns those writes; the board calls it. This is the rule the approve split
already established, and it is exactly why `Extracted` came first.

**Mirror `approve.ts`, do not invent a second shape.** It is the working model,
documented at `approve.ts:62`:

```
no Approve command:    board → plot-approve.sh
with Approve command:  board → agent → SKILL.md → plot-approve.sh
```

Delivery takes the same two routes via a `Deliver command` key (item 10, both
asserted). `APPROVE_COMMAND_KEY` at `approve.ts:65` is the naming precedent.
**`Deliver command` is currently unset in this repo**, so the direct path is what
runs here — but both paths need tests.

**Order is the assertion, not the end state.** Item 4: the reap runs AFTER the
delivery. Both orders end with a delivered plan and no worktree, so an end-state
test passes either way — only one of them never shows a desk-less `Approved`
plan mid-flight. **Assert the ordering.**

**Deferred is not finished.** Item 5: a plan whose remaining waves are all
`deferred` is NOT auto-delivered. Shelved work is a person's call.

**The `Delivered:` record is load-bearing, not provenance.** Item 3: the phase
flip and the record are written in ONE commit. The fleet scan reads its rolling
window from `delivered_raw` — a phase flip without the record makes the plan
*invisible* rather than delivered. Measured on 2026-08-20.

**Idempotence is inherited, not rebuilt.** `plot-deliver.sh` is already
idempotent (item 8) the way `plot-approve.sh` is: it writes irreversibly, so
re-running is the repair. Do not add a progress file or a lock on top.

**A merged PR reports `state: CLOSED`.** Read `mergedAt`, never `state`. And
squash-merge leaves a branch permanently "ahead of main", so ancestry cannot
decide merge state — this cleared 1 of 29 trees here while the host cleared 28.
`plot-reap.sh` already reads it correctly (that was `Landed`, #479); call the
reaper rather than re-deriving.

### Done when

The plan's `## Done when` list is the specification. This wave owns items 3, 4,
5, 6, 7 and 10 (1, 2 belong to `Landed`; 8, 9 to `Extracted`; 11 to `Cleared`).
The ones that exist *because a naive implementation would pass without them*:

- **Item 6** — nothing is delivered while any non-deferred wave is unmerged.
  The gate `/plot-deliver` applies by hand, applied here. An auto-deliverer that
  skips it ships the exact refusal Plot exists to enforce.
- **Item 4** — ordering, asserted as ordering.
- **Item 7** — asserted by ABSENCE. Grep `packages/board` for a phase write and
  find nothing.
- **Item 5** — all-deferred is not finished.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:board`,
`pnpm run test:reconcile` green; **artifact rebuilt and committed**
(`pnpm build:board` from the repo root — from `packages/board` it is
`pnpm build`); a changeset with `'@plot-pm/board': patch` **package
frontmatter** if the change is board-only, or a skills `bumps:` block naming
`plot` if you also touch `skills/plot/`; Node 24 (`nvm use`, and `corepack
pnpm`); `trash` rather than `rm`.

A new `POST /api/*` route must be added to `WRITE_ROUTES` in
`write-gate.test.mjs`, or that test fails.

Board browser tests load the BUILT artifact — build before running them.

### Bookkeeping

When the PR is created, annotate this branch inside its **wave heading** in the
plan's `## Waves` section on main: `(Branch: x, PR: #N)` INSIDE the heading. A
trailing `→ #N` parses as `prs=[]` in the Waves dialect. Check
`git branch --show-current` is main first, or use a detached scratch worktree
(`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns the board-side delivery route and its reap call in
`packages/board/src/server/`, plus tests. It does **not** change
`plot-deliver.sh` (that was `Extracted`) or `plot-reap.sh` (that was `Landed`).

`bug/the-deliver-gate-reads-the-verdicts` is in flight and touches
`allWavesMerged` in `board.ts` plus `deliver.ts`'s verdict handling — the gate
that decides whether a plan MAY be delivered. Yours is what happens when it may.
Expect to touch `deliver.ts`; coordinate rather than reverting, and rebase onto
current main before you start.

Note `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` is a
**tracked fixture** that board test runs rewrite — check `git status` before
committing and never `git add -A` after a suite run.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
