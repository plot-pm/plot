## Implementation brief — the-build-pipeline-is-its-own-connector (slice: The build port exists, with two connectors)

- **Plan (canonical):** `docs/plans/2026-09-07-the-build-pipeline-is-its-own-connector.md` on `main`
- **Branch:** `feature/the-build-port-exists` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **Sprint:** `the-board-serves-a-team` — the goal is *a teammate on Bitbucket, Jenkins and Jira runs Plot unattended from adoption to a delivered plan*

**READ THE PLAN FIRST, AND ITS ROUNDS.** Every plan in this sprint was interrogated at least once and most changed. The Notes record what was cut and why — a slice re-adding it wastes the round.

## What this delivers

See the plan's slice section, which states the constraints and the done-when. **This brief adds only what a plan cannot: the repo's gates and the traps measured this week.**

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile   # shell contract tests
pnpm run typecheck
pnpm run test:board       # rebuilds the artifact, then runs its tests
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one — two agents running it once produced 53 concurrent `node --test` processes at load 8.69.

## Traps measured this week

- **The scan reads plans from `origin/main`, never the working tree.** An annotation is invisible to the fleet until pushed.
- **`test:board` dirties a fixture** — it rewrites `tiny-garden/.plot/state/last-pulse.json` with this machine's estate. Revert before staging.
- **On a conflict in `skills/plot/scripts/board/*.mjs`: do not read the diff.** Generated bundles marked `-merge`. Take either side, `pnpm build:board`, commit the rebuild.
- **The domain package demands 100% branch coverage.** An unreachable `?? null` fails CI — narrow the type rather than testing dead code.
- **Arrow functions** in `packages/domain`, and in anything you newly write elsewhere. The unit is the function, not the file.
- **A test that fails differently each run is machine load**, not a regression. Check `uptime` before chasing it.

## Done when

The plan's done-when holds, verbatim. If you cannot meet a clause, say which and why in the PR rather than restating it as met.
