PLOT-BLOCKED: This wave's entire scope is already merged. Should the branch be marked `moved:` into `feature/the-sweep-names-every-leftover` (#672), or is there scope here I am not seeing?

## What the brief asks for

`.plot/briefs/the-reaper-sweeps-every-kind.md` states its premise twice, and the plan repeats it at `docs/plans/2026-09-02-an-agent-holds-one-desk.md:151`:

> `the-sweep-names-every-leftover` merged as `ec634c2a` and delivered **the rule and nothing else**. [...] **Nothing outside the domain imports it.** Measured 2026-09-03: `plot-reap.sh` still sweeps worktrees only, and this estate carries **109 local branches**.

## What is actually on main

`ec634c2a` delivered the rule **and its caller, in the same PR (#672)**. Its diffstat:

```
packages/domain/src/rules/sweepable.ts   262 ++++
packages/domain/test/sweepable.test.ts   188 ++++
skills/plot/scripts/plot-reap.sh         402 ++++      <-- the adapter
test/reconcile/sweep.test.mjs            423 ++++      <-- 16 tests for it
```

`plot-reap.sh` imports `sweepable.ts` in three places, one per kind — `firstBranchRefusal` (:629), `firstClaimRefusal` (:759), `dirtyTreeOwner` (:842).

## Every "Done when" item, checked against main

| Brief's criterion | State |
|---|---|
| Sweeps all three kinds through the domain rule, no second implementation | Done — 3 `import()` sites, no refusal duplicated in shell |
| Dry run names merged local branches, deletes nothing | Done — verified below |
| `--max N` bounds each kind separately | Done — three counters, `plot-reap.sh:466,673,796` |
| `pnpm run test:reconcile` | 1133 pass, 0 fail |
| `pnpm run test:board` | pass |
| `pnpm run typecheck` | pass |
| `cd packages/domain && npx tsc --noEmit` | pass |
| `pnpm run test:corpus` | pass (domain package, not root — see discovery 2) |
| `pnpm build:board` + artifact committed | no change to build |
| Changeset | nothing to describe |

Dry run on this estate, 2026-09-03:

```
-- local branches --
keep     bug/the-claimable-guard-counts-what-remains   unlanded work — no merged PR
keep     main                                          the default branch — never deleted
keep     docs/the-desk-belongs-to-the-agent            checked out in a worktree — somebody is reading it
would    plot-sweep-gap                                merged into main, no worktree holds it
-- orphaned claim refs --
keep     feature/the-reaper-sweeps-every-kind          still claimed, no commits → needs judgment
-- dirty trees nobody owns --
LEFTOVER bug/the-budget-knows-which-bucket-it-spent    1 uncommitted, owner: nobody — clear it by hand
summary: branches=1 branches_deleted=0 branches_kept=16 claims=0 claims_kept=1 dirty_trees=2 dry_run=1
```

All three kinds report, through the rule, deleting nothing.

## Two further discoveries

1. **The 109-branch measurement is stale.** The estate carries **17** local branches, not 109. The merged sweep is why. The plan's own headline number — *85 of 98 merged, nothing sweeps them* — was fixed by the wave the brief says did not fix it.

2. **`pnpm run test:corpus` does not exist at the repo root.** The brief lists it as a repo gate beside `test:reconcile` and `test:board`, which are root scripts; `test:corpus` is a **domain package** script. Run it as `cd packages/domain && pnpm run test:corpus`. Worth correcting in the brief template, since a worker following the list literally hits `ERR_PNPM_NO_SCRIPT` and may read it as a broken checkout.

## What I did not do

I wrote no code. The brief says to implement what I can and report rather than improvise, and every acceptance criterion is met by a commit that is already on `main`. Inventing scope to justify the branch would add an unrequested second implementation to the one file the brief tells me not to duplicate refusals in.

**The decision is yours:** close this branch as `moved:` into #672, or tell me what this wave was meant to cover that #672 did not.
