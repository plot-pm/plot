## Implementation brief — the-fleet-fixes-every-red-or-conflicting-pr (wave 1: Scope)

- **Plan (canonical):** `docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md` on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3597 merged
- **Branch:** `feature/the-fixer-scope-reads-every-open-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the plan's `Review: pr` — the repo's review app reviews the PR; HIGH findings return to the fixer.

This is wave 1 and the first slice of four. `feature/the-fixer-merges-the-base-into-a-conflicting-pr` (wave 2) and `feature/the-review-reads-the-fixer-scope` (wave 4) wait on it, and wave 3 waits on wave 2. They build on `fixerScope` and `fixerPrNext`, so name and shape these exports as the plan does.

### What to build

fleetd's fixer acts only on PRs that the active sprint names. On 2026-11-20 that left #3594 (conflicting), the master agent's fix PRs #3591 and #3595, and #3589 without a fixer until each merged. Two gates cause it: `readFixerPass` reads `sprintScopeRef` (`packages/fleet/src/shared/auto-fixer.ts:677`) and `guardArm` answers `out-of-scope` for any head the scope does not name (`packages/domain/src/rules/slice-pr-next.ts:178-190`); and for a PR with no worktree on this machine `fixerTick` reads the desk as `{ dead: false, why: 'elsewhere' }` (`auto-fixer.ts:374`), so `ciRedArm` answers `desk-alive` (`slice-pr-next.ts:316`). Widening the scope alone fixes nothing on a deskless PR.

Build in this order:

1. `fixerOwner` — a pure rule answering `desk`, `none` or `unread`.
2. `fixerScope(input)` in `packages/domain/src/rules/fixer-scope.ts` — answers `{ in: true; owner: 'desk' | 'none' }` or `{ in: false; why }`, with the reasons and the order in the plan's table.
3. `fixerPrNext(readings)` in `slice-pr-next.ts` — calls `fixerScope` in place of `guardArm`, then `reviewRunArm`, `fixerInFlightArm`, `highArm`, `ciRedArm`; the first answer that is not `none` wins. State in the TSDoc whether `restatusArm` is dropped (the plan says the fixer walk lists five arms and no `restatusArm`; confirm that is right and say so).
4. `readFixerPass` stops reading `sprintScopeRef` and no longer defaults the base to `'main'` (`auto-fixer.ts:675`), so `base-unread` can fire; `fixerTick` calls `fixerPrNext` in place of `slicePrNext` (`auto-fixer.ts:378`).

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Ownership, not identity, decides "a person pushed".** No field names the pusher. `PrIndexRow.author` is the PR's author, not the head's pusher (`packages/domain/src/entities/pr-index.ts:53`), and the row carries no commit author. Agents and persons commit under one identity (the master agent's commits read `Jan Wloka` with a `Co-Authored-By: Claude` trailer). A rule keyed on commit author therefore cannot work. Do not add an author or committer field.

**Only fleet evidence makes `owner: 'desk'`.** That is a registry manifest, or a claim marker on `origin/<base>..origin/<head>` (`isEmptyClaim`, `packages/domain/src/rules/empty-claim.ts:35`, read through `Refs.commitSubjects`). A worktree made by hand with no worker records is `owner: 'none'` and waits the hour (panel round 1; `deskDeadFromWorkerState`, `auto-fixer.ts:164-176,371-374`). `Trees.forBranch` alone is not desk evidence.

**A failed read is `unread`, and `unread` starts nothing.** A failed `forBranch` or `commitSubjects` read gives `owner-unread`. Add one `fixerTick` test for it. The index never says no.

**The quiet hour.** For `owner: 'none'` where `fixerPushedHead` (`fixer-attempts.ts:59`) is false, the head's age is `now − headSince`. `PERSON_QUIET_MS` is 3 600 000. Below it: `person-pushed-recently` (carry the time left in the reason's detail, because slice 3 shows it). An absent or unparseable `headSince`: `head-age-unread`. `headSince` is the time the fold first saw the head on this machine's clock (`pr-index.ts:68-75`); it lags the push by at most one PR pass and resets on a rebuilt store, and both errors lengthen the hold. They never shorten it, so no correction is needed. A fixer-pushed head skips the hour: the fixer's own push is not a person at work.

**A claimed branch with no desk on this machine** (`elsewhere`, `auto-fixer.ts:374`) becomes fixable once its claim is older than `Claim stale after` and the quiet hour has passed (panel round 1). Read `Claim stale after` through the existing config path; do not hardcode 24.

**Repair and revert branches are out by name** (`bug/main-repair-<12 hex>`, `bug/sprint-repair-<12 hex>`, `bug/revert-<n>`): their roles own and claim them (`packages/fleet/src/shared/repair-start.ts:214`). A claim marker alone would make them `owner: 'desk'`, and a dead repair desk would get a second writer. `repair-owned` is checked before the owner reading.

**For `owner: 'none'`, `fixerPrNext` hands the arms `desk: { dead: true }`.** No agent owns the branch and the quiet hour has passed. For `owner: 'desk'` it hands them today's desk reading. Do not change `ciRedArm` or `highArm`.

**Review and merge keep the sprint scope.** `slicePrNext` and `guardArm` do not change; `auto-review.ts:218` and `auto-merge.ts:378` keep reading `sprintScopeRef`. Widening those is slice 4. Prove it with a test: `slicePrNext` still answers `out-of-scope` for a PR that `fixerPrNext` takes.

**Out of scope, by operator decision.** `idea/*` plan PRs stay out (`base-out-of-scope` or the head-prefix rule, whichever the plan's table gives; do not invent a reason). Fork PRs carry no head-repository field, so they stay out of scope until one exists; say so in the TSDoc. The `plot:hands-off` label is in the plan's operator decisions but no slice owns a field for it yet; do not build it here, and report where it should land.

**Rules carried over unchanged.** The index never says no: a missing row field is `unread`, never "no". Read the exit code, not the emptiness. Every existing refusal stays: the in-flight hold, both budgets, the start lock, the re-ask of the head before the start (`auto-fixer.ts:496-501`), `fixerAdmission` with one fixer at a time, the 3600 s bound. Read the claim commits only for a row that passes every check before `owner-unread`, so a PR out of scope costs no `Refs` call.

### Done when

The plan's `## Slices › Scope` line is the specification. The unit cells the plan names, one per row of the reason table, plus:

- a PR into `sprint/x` is in; a PR into `release/1` is out (`base-out-of-scope`);
- a deskless PR whose head is 59 minutes old holds, and one 61 minutes old is in; add the exact 60-minute boundary cell, since `<` against `PERSON_QUIET_MS` is the one place an off-by-one hides;
- a fixer-pushed head 5 minutes old is in;
- a claimed branch with a 5-minute-old head is in with `owner: 'desk'`;
- a hand-made worktree with no manifest and no claim is `owner: 'none'`;
- a deskless red PR answers the `fixer` step from `fixerPrNext` and `out-of-scope` from `slicePrNext` — this catches an implementation that widened `guardArm` and so widened review and merge too;
- a failed `forBranch` or `commitSubjects` read answers `owner-unread` and starts nothing — this catches an implementation that treats a failed read as "no desk", which would fix a PR an agent owns;
- a row with no `base` answers `base-unread` — this catches the `?? 'main'` default surviving in `readFixerPass`.

`packages/fleet/test/auto-fixer.test.ts` changes in three places the panel named: `:59` passes `scope`, which this slice removes; the world's `refs` pick needs `commitSubjects` (`auto-fixer.ts:63`); and `:650` and `:665` change reason. The failed-start hold keys on head (`auto-fixer.ts:383`); leave that for slice 2, which adds the base tip.

Plus: a changeset for `plot` with the description first and the `bumps:` block last, with `plan: docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md` inside the block. Domain code uses arrow functions and factual TSDoc only (no history in comments); put reasoning in the commit message. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you find you need one, write the rule in the domain and ask it through a bundle. Commit no board bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When it is open, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/fixer-scope.ts` (new), `packages/domain/src/rules/slice-pr-next.ts` (adds `fixerPrNext`; leaves `guardArm` and `slicePrNext` alone), `packages/fleet/src/shared/auto-fixer.ts`, their tests, and the changeset.

Not here, and held by other branches in the plan: the `conflict` finding, `conflictArm`, `not-conflicting` and the merge-arm word `conflicting` (wave 2, `slice-pr-next.ts:395,429`); `RoleRun.finding` and the Delivery row wording (wave 3); `reviewPrNext` and `auto-review.ts` (wave 4). Wave 4 renames the scope rule for both roles, so keep `fixerScope`'s input free of anything fixer-specific beyond the attempts proof.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
