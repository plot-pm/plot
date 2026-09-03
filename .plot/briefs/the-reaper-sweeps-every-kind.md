## Implementation brief — the-reaper-sweeps-every-kind (wave Wiring the sweep)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `feature/the-reaper-sweeps-every-kind` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 4 of six. It finishes the job `the-sweep-names-every-leftover` started.

### What already exists, and what does not

`the-sweep-names-every-leftover` merged as `ec634c2a` and delivered **the rule and nothing else**. `packages/domain/src/rules/sweepable.ts` is complete and unit-tested — three kinds, a refusal list per kind, and `*SweepProblems` returning EVERY problem rather than the first, so a refusal can name everything wrong at once.

**Nothing outside the domain imports it.** Measured 2026-09-03: `plot-reap.sh` still sweeps worktrees only, and this estate carries **109 local branches**, most with merged PRs. The plan's original measurement — *85 of 98 merged, nothing sweeps them* — is unchanged by the wave that was supposed to change it.

That split is the layering rule working correctly: the domain decides, an adapter reaches the world. **This branch is the adapter.**

### What this branch owns

**A caller for each of the three kinds** the rule names: `local-branch`, `claim-ref`, `dirty-tree`. The decisions are already made — `isSweepableBranch`, `isSweepableClaim`, and the dirty-tree pair. Do not re-derive them in shell, and do not add a second copy of any refusal.

**The reaper's existing shape, unchanged.** `--dry-run` is the default (`plot-reap.sh:136-138`), `--yes` acts, `--max N` bounds — and the bound is **per kind**, so bounding branch deletion does not bound desk removal.

**`pr_merged` is the gate for a local branch, never `git branch -d`.** `-d` refuses an unmerged branch, which sounds like the safety this needs and is not: squash-merge leaves a branch permanently ahead of main, so `-d` would refuse the whole population for the wrong reason. `plot-pr-merged.sh` is sourced, not run, and an unreachable host answers *not merged* — silence is never permission.

**The per-kind licence stays, and it is a real asymmetry.** A removed checkout comes back with `git worktree add`; a deleted **remote** ref does not, which is why `plot-release-refs.sh` is plan-scoped. A **local** branch sits between: it is re-fetchable from origin, so it is a copy rather than the copy, and the caution that protects remote refs does not transfer to it.

### What it does NOT own

**The rule.** `sweepable.ts` is merged and its tests pass; changing a decision means changing the plan, not this branch.

**Remote refs.** `plot-release-refs.sh` owns those and stays plan-scoped.

**Desk creation or reset.** `an-agent-decides-create-or-reset` merged as `a2a3c2d3`.

### Done when

- `plot-reap.sh` sweeps all three kinds through the domain rule, with no second implementation of any refusal.
- A dry run on this estate names the merged local branches it would delete, and deletes nothing.
- `--max N` bounds each kind separately.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here produced 53 concurrent test processes and a board that could not answer in 25 seconds.
