## Implementation brief — a-sprint-item-has-one-scorer (slice: One scorer, called by both)

- **Plan (canonical):** `docs/plans/2026-09-07-a-sprint-item-has-one-scorer.md` on `main`
- **Branch:** carries this slice; base `main`
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **Waited on:** `infra/a-shell-script-asks-the-domain`. It **has landed** — merged as PR #805 and its plan is Delivered, so the seam, the corpus readers and the comparison test are all on `main`. Start.
- **Sprint:** `the-board-serves-a-team`

**READ THE PLAN AND ITS ROUNDS FIRST.** Every plan here was interrogated and most changed; the Notes record what was cut and why. A slice re-adding it wastes the round.

**AND READ WHAT YOU WAIT ON.** This slice was ordered behind `infra/a-shell-script-asks-the-domain` for a stated reason — a contract it needs, or a shape it should not invent twice. Its PR is the input to yours.

## What this delivers

The plan's slice section states the constraints and the done-when. **This brief adds only what a plan cannot: the repo's gates and the traps measured this week.**

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile
pnpm run typecheck
pnpm run test:board
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one — two agents running it once produced 53 concurrent `node --test` processes at load 8.69.

## Traps measured this week

- **The scan reads plans from `origin/main`, never the working tree.** An annotation is invisible to the fleet until pushed.
- **`test:board` dirties a fixture** — `tiny-garden/.plot/state/last-pulse.json`. Revert before staging.
- **On a board bundle conflict, do not read the diff.** Marked `-merge`; take either side, `pnpm build:board`, commit the rebuild.
- **The domain demands 100% branch coverage.** Narrow the type rather than testing dead code.
- **Arrow functions** in `packages/domain` and in anything newly written.
- **A test failing differently each run is machine load.** Check `uptime` first.

## Done when

The plan's done-when holds, verbatim. If a clause cannot be met, say which and why in the PR rather than restating it as met.
