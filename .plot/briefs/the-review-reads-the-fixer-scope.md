## Implementation brief — the-fleet-fixes-every-red-or-conflicting-pr (wave 4: Review)

- **Plan (canonical):** `docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md` on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3597 merged
- **Branch:** `feature/the-review-reads-the-fixer-scope` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the plan's `Review: pr` — the repo's review app reviews the PR; HIGH findings return to the fixer.

This is the last slice of four. It waits on wave 1 only (`feature/the-fixer-scope-reads-every-open-pr`, merged as #3600), is independent of waves 2 and 3 (both merged), and nothing waits on it. Preflight, 2026-11-22: `fixerScope`, `fixerOwner`, `fixerPrNext` and `conflictArm` are on main; no open PR touches `slice-pr-next.ts`, `auto-review.ts`, `auto-merge.ts`, `fixer-scope.ts` or `auto-fixer.ts` (only the release PR #3598 is open and it carries none of them).

### What to build

The fixer now acts on every open PR that no person works on, but review does not. `readReviewPass` reads `sprintScopeRef` (`packages/fleet/src/shared/auto-review.ts:220`) and `reviewTick` calls `slicePrNext` (`auto-review.ts:115`), whose `guardArm` answers `out-of-scope` for any head the sprint does not name (`packages/domain/src/rules/slice-pr-next.ts:207-218`). A PR outside the sprint therefore gets no `plot/review`: a fixer can repair its CI, and nothing judges the result. On 2026-11-20 that was #3594, #3591, #3595 and #3589. Operator decision, 2026-11-20: auto-review widens to the fixer's scope.

Build:

1. **Rename the scope rule for both roles.** `fixerScope`, `fixerOwner`, `fixerScopeRow` and their types (`packages/domain/src/rules/fixer-scope.ts`) now serve review as well, so their names stop saying "fixer". The plan fixes the intent, not the name; pick one name family (for example `fleetScope`), change every caller and test in the same commit, and say the names in the commit message. `PERSON_QUIET_MS` and `claimStaleMsOf` follow. Do this as its own first commit so the later diff reads as behaviour.
2. **`reviewPrNext(readings)`** in `slice-pr-next.ts`, beside `fixerPrNext`. It walks: `repairNamesPr` first (against `readings.repairMerge` and `readings.baseRepairMerge`, exactly as `guardArm` does at `:212-213`); where neither names the PR, the renamed scope rule with the owner reading; then `reviewRunArm`, `restatusArm`, `reviewArm`, first answer that is not `none` wins, and with none `reviewArm`'s `none` is returned because it names the reason (as `slicePrNext` does). `mergeArm`, `highArm`, `ciRedArm`, `conflictArm` and `fixerInFlightArm` are not walked: HIGH and CI belong to the fixer pass, merge to the merge pass. State this in the TSDoc.
3. **The review pass reads the owner.** `reviewTick` is synchronous (`auto-review.ts:97`) and the owner reading is not: `fixerTick` awaits `Trees.forBranch`, the registry's `declared()` and `Refs.commitSubjects` per row (`auto-fixer.ts:429-438`). Read the owners before `reviewTick` runs, in the pass, not inside the synchronous loop, and hand them in as a value per PR. Reuse the fixer pass's reading code rather than copying it; a second copy of the owner reading is the drift this slice must not add. Read the claim commits only for a row that passes `fixerScopeRow` and is not named by a repair record, so a PR out of scope costs no `Refs` call.
4. **`readReviewPass` stops reading `sprintScopeRef`** and stops defaulting the default branch to `'main'` (`auto-review.ts:217`), so `base-unread` can fire, the same defect slice 1 removed from `readFixerPass`. It reads `Claim stale after` through the config path `readFixerPass` uses (`auto-fixer.ts:768`); never hardcode 24.
5. **The attempts proof.** The scope rule's `pushedHead` input needs the fixer's attempts record for the PR (`fixerReadingOf`, `fixerPushedHead`). Without it, a head the fixer just pushed would wait the quiet hour for its re-review, because `headSince` is the fold's first sight of it and the fixer is not a person. Read the record for the PR's number, as the fixer pass does.
6. **`auto-review.ts` calls `reviewPrNext`;** `auto-merge.ts` keeps `slicePrNext` and `sprintScopeRef` (`auto-merge.ts:261,381`). Do not edit `auto-merge.ts`, `guardArm` or `slicePrNext`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`repairNamesPr` comes before the scope rule, because the scope rule answers `repair-owned` for exactly the PRs the repair record names.** The repair merge reads `plotReview` (`repairMergeVerdict`), and `guardArm` admits a repair or revert PR through `repairNamesPr` before the scope check today. A review that reuses the scope rule without that admission stops reviewing repair PRs and regresses the repair role. A repair-branch PR that the record does not name stays out: the repair roles own the branch, and a second reader of it is a second writer.

**Review and merge keep different scopes, and that is the point of a separate walk.** `slicePrNext` is shared by review and merge today (`auto-review.ts:115`, `auto-merge.ts:261`). Widening `guardArm` would widen merge: a merge cannot be undone, and the operator widened the fixer and review, not merge. The panel (testability, `.plot/panels/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr/testability.md`, point 4) put review in its own slice for this reason.

**The same rule scopes both roles, quiet hour included.** A deskless PR whose head a person pushed less than 3 600 000 ms ago gets no review yet, and a fixer-pushed head or an agent-owned branch skips the hour. This is the plan's wording ("the fixer's scope rule (renamed for both roles)"), not an oversight: it keeps review from judging a branch a person still works on. Do not add a review-only exception. If the hour turns out to delay reviews of green PRs in a way the operator does not want, report it with a measured delay; do not change the rule here.

**Only fleet evidence makes `owner: 'desk'`, and `unread` starts nothing** — unchanged from slice 1. A failed `forBranch`, `declared` or `commitSubjects` read answers `owner-unread` and no review starts. A review start on an `unread` owner would review a PR an agent still owns.

**`owner: 'desk'` is in for review.** Review already runs on live-desk slice PRs today (`readReviewPass` hands `desk: { dead: false, why: 'live' }`). The desk reading matters only to `ciRedArm` and `conflictArm`, which this walk does not call, so the review walk reads no desk. Do not invent one.

**The budget is unchanged and now bounds a wider set.** `REVIEW_START_BUDGET` stays 3 per head and `REVIEW_BOUND_MS` 1 h. Review spend grows with the set, not with the budget; the plan names this and accepts it. The review re-ask needs no change: `pr-refresh.ts:1603` passes every stored head to `reviewReaskPrNext`'s caller `reviewReaskPrNumbers` already, unscoped.

**A spent HIGH now opens tickets for PRs no plan names** (`highArm`, `slice-pr-next.ts:275-287`, in the fixer walk). This slice does not touch `highArm`; the widening is the fixer's, from slice 1. Report in the PR body whether the review's `plot/review` written on an unplanned PR changes anything the ticket path reads.

**Rules carried over unchanged.** The index never says no: a row with no `plotReview` was never asked and answers `none` (`reviewArm`, `restatusArm`); a row with no `base` or an unread default branch answers `base-unread`, never "in". Read the exit code, not the emptiness. Every existing refusal stays: the in-flight run hold, the start budget, the review lock, `review-writer-unchecked`.

**Out of scope, by operator decision.** `idea/*` plan PRs, release PRs and fork PRs stay out, as in the fixer (`fixerScopeRow`'s `plan-pr`, `release-pr`; a fork is not told apart because the row carries no head repository, so say so in the TSDoc). The `plot:hands-off` label is in the plan's operator decisions and no slice owns a field for it; do not build it here, and report where it should land.

### Done when

The plan's `## Slices › Review` line is the specification. Domain cells in `packages/domain/test/slice-pr-next.test.ts`, one per row of the testability verdict:

- a deskless green PR into `main` outside the sprint answers `review` — this catches an implementation that kept `guardArm`;
- the same PR with a 59-minute-old person head holds `person-pushed-recently` with `leftMs`, one exactly 60 minutes old is in, and a 61-minute-old head answers `review` — the exact boundary is the one place an off-by-one hides;
- a head the fixer pushed 5 minutes ago answers `review` — this catches an implementation that never reads the attempts proof;
- a PR into `sprint/x` is in and a PR into `release/1` is out (`base-out-of-scope`);
- a release PR, an `idea/*` PR and an unnamed repair-branch PR are out; a repair PR named by the repair record, and one named by a base repair record, answers `review` — this catches the scope rule running before `repairNamesPr`;
- `owner: 'unread'` answers `owner-unread`;
- a row with no `base` answers `base-unread`;
- `slicePrNext` still answers `out-of-scope` for the PR that `reviewPrNext` takes — this catches an implementation that widened `guardArm` and so widened merge too.

Fleet cells for `runAutoReviewPass` / `reviewTick` in the existing `packages/fleet/test` review test file: the pass reads no sprint scope (a world that throws on a scope read still passes); a failed owner read starts no review; `startReview` is called for a deskless PR outside the sprint; the `REVIEW_START_BUDGET` still bounds starts over the wider set; a PR out of scope costs no `Refs` call (count the world's `commitSubjects` calls). Changing the pass's shape moves existing cells that pass `scope` — name each in the commit message.

Plus: a changeset for `plot` with the description first and the `bumps:` block last, with `plan: docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md` inside the block (`./scripts/check-changeset-packages.sh`). Domain code uses arrow functions and factual TSDoc only, no history in comments; reasoning goes in the commit message. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Commit no board bundle (`scripts/check-no-bundle-diff.sh`). `CLAUDE.md` says "the fixer's scope" in several places; update the text only where it describes a rule you renamed, then run `./scripts/check-agents-md.sh --write`.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When it is open, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/fixer-scope.ts` (renamed names only), `packages/domain/src/rules/slice-pr-next.ts` (adds `reviewPrNext`; leaves `guardArm`, `slicePrNext` and the arms alone), `packages/fleet/src/shared/auto-review.ts`, the callers of the renamed rule (`packages/fleet/src/shared/auto-fixer.ts`, tests), and the changeset.

Not here: `auto-merge.ts` and `mergeArm` (merge keeps the sprint scope); `highArm`, `ciRedArm`, `conflictArm` (the fixer walk); the board's Delivery row (wave 3, merged); the `plot:hands-off` label (no slice owns it). No other open branch holds these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
