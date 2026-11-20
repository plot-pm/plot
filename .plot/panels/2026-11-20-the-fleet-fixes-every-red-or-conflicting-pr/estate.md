# estate — the-fleet-fixes-every-red-or-conflicting-pr

Position: amend

All code claims below are against `origin/main` at `b526e90e3`, read with `git show origin/main:<path>`. "Opened" means I read the code at that line. I ran no tests.

## Findings

1. **A person's worktree on this machine reads as a dead agent desk, so the fixer starts on it at once and skips the person-push hour.** The plan sets `owner: 'desk'` "where a worktree on this machine holds the branch (`Trees.forBranch`)" and says "an agent claimed the branch, so its head is an agent's push". That premise does not hold. `fixerTick` reads `workerState` for any worktree that `forBranch` finds (`packages/fleet/src/shared/auto-fixer.ts:371-374`). `deskDeadFromWorkerState` maps every state except `elsewhere`, `waiting` and `running` to `{ dead: true }` (`auto-fixer.ts:164-175`, opened). A master agent's or a person's own worktree under `.worktrees/` has no fleet worker, so its state is `none`, it reads as dead, and `ciRedArm`'s `deskGone` is true (`packages/domain/src/rules/slice-pr-next.ts:315`). Today the sprint scope hides this, because master-agent fix PRs such as #3591 and #3595 are out of scope. The plan makes those PRs in-scope, so this is the exact case where the fleet races a person. **Change:** in the owner table, base `owner: 'desk'` on fleet-made evidence only: a registry manifest for the branch, or the claim marker. A worktree with no manifest and no claim gives `owner: 'none'`, so the `headSince` hour applies. Add a unit cell: "an unclaimed branch with a local worktree and no worker, head 5 minutes old, holds `person-pushed-recently`".

2. **A claimed branch with no worktree here stays `elsewhere`, so a red or conflicting slice whose desk is gone still gets no fixer.** The fleet commits a claim marker on every slice it starts (`plot: claim <branch>`, `isEmptyClaim`, `packages/domain/src/rules/empty-claim.ts:35`). Repair branches carry one too (`repair-start.ts:214`). With no worktree on this machine, `fixerTick` still sends `{ dead: false, why: 'elsewhere' }` (`auto-fixer.ts:374`), and the plan says that for `owner: 'desk'` "a live, waiting or elsewhere desk holds as it does now". So the Motivation's own complaint ("a widened scope alone would still fix nothing on a PR that no agent ever owned") is fixed only for unclaimed branches. A slice PR whose desk was removed, or whose machine is gone, waits forever. That is half of the operator's requirement. **Change:** state this as intended, or lift it with the existing `Claim stale after` key (24 h): an `elsewhere` desk whose claim is older than the bound, and whose head is older than `PERSON_QUIET_MS`, counts as `owner: 'none'`. Add the cell.

3. **The review widening (operator decision) needs its own walk, not a change to `guardArm`, because review and merge share one walk and one guard.** `readReviewPass` reads `sprintScopeRef` at `packages/fleet/src/shared/auto-review.ts:218`. `auto-merge.ts:378` reads the same scope. Both call `slicePrNext`, whose single walk is guard → `reviewRunArm, fixerInFlightArm, highArm, restatusArm, ciRedArm, reviewArm, mergeArm` (`slice-pr-next.ts:467-477`). Widening `guardArm` would therefore also widen merge, which the plan says it keeps. **What it needs:**
   - (a) A `reviewPrNext` that calls the shared scope rule and then `reviewRunArm`, `restatusArm` and `reviewArm` only. Name the rule for both roles, for example `unattendedScope`, because `fixerScope` is wrong once review uses it. `readReviewPass` stops reading `sprintScopeRef`. `slicePrNext` stays for merge.
   - (b) No index change. The PR pass's review re-ask is already unscoped: `pr-refresh.ts:1596-1604` passes every stored head to `reviewReaskPrNumbers` (`packages/domain/src/rules/pr-index.ts:372`).
   - (c) Budget and bounds stay as they are: `REVIEW_START_BUDGET = 3` per head (`rules/review-run.ts:28`), `REVIEW_BOUND_MS = 3_600_000` (`auto-review.ts:64`). Spend grows with the number of widened open PRs times their pushes. The plan must say this, because the review app's spend is the cost the Open Question names.
   - (d) After its budget is spent, `highArm` answers `ticket` (`slice-pr-next.ts:275-287`). A widened review therefore opens tracker tickets for PRs that no plan names, which is a new write. State it, or hold `ticket` for out-of-sprint PRs.
   - (e) Tests: `reviewPrNext` answers `review` for a deskless green PR into `sprint/x` that `slicePrNext` answers `out-of-scope`, and it holds `person-pushed-recently` on a 59-minute head.
   - **Slice placement:** a separate slice, `waits:` slice 1. Slice 1 alone already changes the fixer's start rate. Adding review spend to the same PR makes one PR carry two independently revertible behaviours.

4. **The merge-arm word fix misses two fixtures.** The plan names `slice-pr-next.test.ts:540,598`. Two more fixtures compare `'CONFLICTING'` on the merge arm: `:655` (base repair) and `:709` (repair branch on red), both opened. All four must move to the stored word. The plan's claim itself holds. `mergeableOf` returns `'conflicting'` (`packages/domain/src/rules/mergeable-of.ts:13,25-26`), `host-shell.ts:80` lists only lowercase words, and the only two production comparisons are `slice-pr-next.ts:395,429`.

5. **The `not-conflicting` refusal should state that it spends no attempt, and that an `unknown` reading refuses.** GitHub answers `mergeable: UNKNOWN` for a while after the base moves, so `prState` gives `'unknown'` (`skills/plot/scripts/plot-host.sh:703-704`). The plan's re-ask refuses that, which is correct, because the index never says no. The plan must say that the refusal comes before the attempt is written, as `head-moved` does today (`auto-fixer.ts:496-501`). Otherwise an `unknown` window burns the 2-attempt budget. Bitbucket holds: `pr-state` folds `mergeable` locally (`plot-host.sh:2119-2158`), and the listing does the same (`bitbucket-pr-listing.ts:213-241`).

6. **Keeping `FIXER_ATTEMPTS_VERSION` at 1 contradicts the entity's own contract wording, though the effect is the one the plan wants.** `entities/fixer-attempts.ts:3-11` says the version literal exists so that a new format reads as unreadable. The plan gets that result through the strict union failing. It works, because `fixerInFlight` answers true on `'unreadable'` (`rules/fixer-attempts.ts:78-80`). But an older board's `roleRuns` then skips that PR's fixer run silently (`rules/agent-roles.ts:93-94`). Say so in slice 2, or bump to 2.

7. **References that hold as cited (opened):**
   - `auto-fixer.ts:372,374,378,496-501,677`
   - `slice-pr-next.ts:180-182,185-186,315-316,395,429`
   - `entities/fixer-attempts.ts:21-24`
   - `rules/fixer-attempts.ts:59,78-82`
   - `pr-index.ts:53` (`author`) and `:68-75` (`headSince`, this machine's clock, reset on a head move)
   - `empty-claim.ts:35`
   - `agent-loop.ts:541`
   - `host-shell.ts:122`
   - `bitbucket-pr-listing.ts:241`
   - `fixer-start.ts:8-10`
   - `agent-roles.ts:93-104`
   - `board/src/contract/schema.ts:4489`
   - `delivery-row-facts.ts:158-159`, inside `agentRowFactsOf`, which has `run` in hand at `:116`
   - `delivery-row-form.ts:165,635`

   On the `repair-owned` exclusion: the fixer pass passes no `repairMerge` (`auto-fixer.ts:678-691`), so today's fixer never admits a repair PR through `guardArm:183-184` either. The exclusion matches current behaviour. Layering holds: `fixerScope` takes readings as values, and the tick reads claims through `Refs.commitSubjects`, whose `CommitSubject` is structurally a `CommitReading` (`ports/refs.ts:161-165`). That satisfies `check-claim-prefix-comparison.sh`, provided the rule calls `isEmptyClaim` and never `startsWith`.

## What I looked at

- `git show origin/main:` for:
  - `packages/fleet/src/shared/auto-fixer.ts` (150-180, 360-385, 490-505, 670-760)
  - `packages/domain/src/rules/slice-pr-next.ts` (170-500)
  - `packages/domain/src/entities/fixer-attempts.ts`, `packages/domain/src/rules/fixer-attempts.ts`
  - `packages/domain/src/entities/pr-index.ts` (50-78), `packages/domain/src/rules/pr-index.ts` (355-395)
  - `packages/domain/src/rules/empty-claim.ts`, `packages/domain/src/rules/mergeable-of.ts`, `packages/domain/src/rules/github-pr-row.ts`
  - `packages/domain/src/adapters/host/host-shell.ts`, `packages/domain/src/adapters/host/bitbucket-pr-listing.ts`
  - `packages/domain/src/workflows/agent-loop.ts`, `packages/domain/src/rules/fixer-start.ts`, `packages/domain/src/rules/agent-roles.ts`
  - `packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`, `packages/domain/src/rules/delivery-row-form.ts`
  - `packages/fleet/src/shared/auto-review.ts` (205-235), `packages/fleet/src/shared/auto-merge.ts` (370-385), `packages/fleet/src/shared/repair-start.ts` (205-220), `packages/fleet/src/shared/pr-refresh.ts` (1590-1606)
  - `skills/plot/scripts/plot-host.sh` (`mergeable` lines), `packages/domain/test/slice-pr-next.test.ts` (536-600)
- `git grep` for `'CONFLICTING'`, `isEmptyClaim`, `reviewReaskPrNumbers`, `REVIEW_START_BUDGET`, `RoleRunSchema`. Read `scripts/check-claim-prefix-comparison.sh`.
