# Panel — the-fleet-fixes-every-red-or-conflicting-pr

Round 1, 2026-11-20, on b1eeebcfe. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`**. No juror rejects. The operator approves on no reject (2026-11-20); the points below are builder notes, copied into the plan's Notes. Operator decisions made during the round: auto-review widens to the fixer's scope (own slice 4); a `plot:hands-off` label opts a PR out; on a person's PR the fixer acts on HIGH findings.

## What all three found

1. **A worktree made by hand reads as a dead agent desk** (estate 1, user 1; testability 1 for the failed listing). The plan sets `owner: 'desk'` for any local worktree, and `deskDeadFromWorkerState` reads a worktree with no worker records as dead (`auto-fixer.ts:164-176,371-374`), so a master agent's or a person's PR worktree gets a fixer at once, with no quiet hour. A failed worktree listing reads as "no worktree" (`auto-fixer.ts:372-373`) and would do the same to a live desk.
2. **The review widening needs its own walk and slice** (all three). Review and merge share `slicePrNext` and `guardArm` (`auto-review.ts:115,218`, `auto-merge.ts:261,378`); `guardArm` lets repair and revert PRs through via `repairNamesPr` before the scope check (`slice-pr-next.ts:183-184`).

## Where the lenses add their own weight

- **Claimed branch, no desk here** (estate 2): `fixerTick` sends `elsewhere` (`auto-fixer.ts:374`), so a red slice PR whose desk is gone stays unfixed.
- **Stop and visibility** (user 2, 3): converting to draft is the only stop; the new holds reach neither the log nor the board (`auto-fixer.ts:378-381`).
- **Tests per slice** (testability 2): `auto-fixer.test.ts:59` passes `scope`; the world's `refs` pick lacks `commitSubjects` (`auto-fixer.ts:63`); the tests at `:650,:665` change reason; the failed-start hold ignores the base tip (`auto-fixer.ts:383`).
- **Plan PRs** (user): `idea/*` comes into scope; a `State:` conflict stops at `plot-state-gate.sh`.
- **Smaller**: `base-unread` never fires because `readFixerPass` defaults to `'main'` (`auto-fixer.ts:675`); the merge-word fix also needs `slice-pr-next.test.ts:655,709`; `not-conflicting` must refuse before the attempt is written (GitHub's `UNKNOWN` window); an older board hides a `conflict` run silently; reuse `MergeabilitySchema` (`entities/pr.ts:21`); a 60-minute boundary cell; say whether `fixerPrNext` drops `restatusArm`; cite `rolePushViolation` (`role-gate.ts:192-236`); fork PRs carry no head-repository field.

## What the jurors looked at

All three opened the cited code at origin/main `21ae2c638` and later; none ran the tests.
