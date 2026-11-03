## Implementation brief — release-resolution-reads-a-cross-repo (wave 1: Local release references)

- **Plan (canonical):** `docs/plans/2026-11-03-release-resolution-reads-a-cross-repo.md` on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3082 merged
- **Branch:** `bug/release-pr-reads-local-references` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review App, required since 2026-10-15)

This wave opens the plan. `bug/release-tag-contains-every-local-pr` waits on it, and `bug/scan-release-asks-the-domain` waits on that one.

### What to build

Issue #3081: a plan with `→ #33` here and `→ owner/other-repo#280` elsewhere cannot be released. `plot-plan-meta.sh` `extract_prs` keeps only the number and sorts ascending, so `releasePr(prs, deferredPrs)` (`packages/domain/src/rules/release-tag.ts:29-32`, called at `packages/board/src/server/entry/deliver.ts:806`) takes 280, the highest. `--release` then refuses `last PR (#280) carries no mergeCommit`, although #33 merged.

Change `releasePr` so it reads references with their repository and deferral and answers `local` (every non-deferred unprefixed PR number), `all-foreign` (the foreign repositories) or `none`. Change `deliver.ts` so an `all-foreign` plan is booked Released with reason `all-prs-foreign`: no host call, no tag lookup, the `Released:` record names the requested version and today's date, the state receipt names the reason and the repositories, and the booking runs the same record and tracker step as a resolved booking. Wave 2 adds the tag logic for several local PRs. This wave resolves the tag from the first `local` PR number as today. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **Local means unprefixed.** Every `owner/repo#N` is foreign, even one naming this repository. `branchClaims` (`packages/domain/src/rules/cross-repo-reference.ts:56`, `SliceReference.repo === ''`) and `plot-impl-status.sh:137` already use this rule. Do not compare remotes and do not add a fork rule.
- **The qualifier comes from `branchClaims`, deferral from the plan record.** Deferral is per branch: `PlanRecordBranch.deferred` (`packages/domain/src/ports/plan-store.ts`). A reference is deferred when its branch is. `plot-plan-meta.sh` gains no field, because `prs` and `deferred_prs` stay as they are. Adding a field would move the plan-store corpus, `plan-store-fixture.ts`, `plan-store-shell.test.ts` and the board's cards, and it would grow the shell. `prs` merges `#33` and `other/repo#33` into one entry and puts a deferred foreign `33` into `deferred_prs`, which is why the parser output cannot carry this.
- **A non-deferred branch with no annotation keeps today's refusal** (`names no '→ #N' annotation`), even when another branch names a foreign PR. An unannotated local branch must never read as `all-foreign`. A branch whose only evidence is `→ commit <sha>` or `owner/repo@sha` has no PR reference, answers `none`, and is never passed to `git tag --contains`.
- **Keep the function name `releasePr`** and rewrite its TSDoc as the new contract (factual API doc, no history). It has one caller, `deliver.ts:806`.
- **Out of scope:** commit-hash slice lines, `prs`/`deferred_prs` parser output, the board's `#280` card link (`board.ts:2707`), `finishRelease`.
- **Carried rules:** absent is not false, so a missing answer never reads as `all-foreign`. `runRelease` refuses `PLOT_UNATTENDED=1` (`deliver.ts:791-795`) and the all-foreign arm sits after that check. Domain code uses arrow functions. Scan section 6 is NOT this wave's: do not touch `plot-reconcile-scan.sh`.

### Done when

The plan's `## Done when` list and the tests under `### Tests` are the specification. Wave-1 cases, each failing on `origin/main` except the regression:

- `packages/domain/test/release-tag.test.ts`: `#33` plus `other/repo#280` answers local `[33]`. `#33` plus `other/repo#33` answers local `[33]`. `#33` plus a deferred `other/repo#33` answers local `[33]`. Foreign-only answers `all-foreign` with the repositories. A foreign reference plus an unannotated non-deferred branch answers `none`. A foreign number lower than the local one answers the local one (regression: passes before and after).
- `test/reconcile/deliver-release.test.mjs`: its `gh` stub ignores `--repo` and answers every number merged, so mark the foreign number closed (`GH_STUB_CLOSED=280`). Cases: `→ #33` plus `→ owner/other-repo#280` asserts `PR #33 merged` and `Released: … v0.1.0`; the same number in both repositories; a deferred foreign number equal to the shipped local one; an all-foreign plan booked Released with `all-prs-foreign`, with no `gh pr view` call and the reason in the receipt. Without the closed-280 setting, the stub would pass the buggy code, so keep it in every new test.

Plus: a changeset (`plot` package, description first, `bumps:` block last), no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`), and a changed bundle source rebuilt only to test locally. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and not `test:e2e`.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This wave should add no shell. If a `.sh` file must grow, pay for it in the same change by removing shell elsewhere or by asking the domain through a bundle. Joining statements with `;` or `&&` is not a payment.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/release-tag.ts`, `packages/domain/test/release-tag.test.ts`, the release arm of `packages/board/src/server/entry/deliver.ts` (about lines 797-860) and `test/reconcile/deliver-release.test.mjs`, plus a changeset. In flight now: `bug/release-approve-tells-its-tracker` (#3071) moves the tracker step out of `runRelease` into `entry/release-tracker.ts`, so whichever lands second rebases, and the all-foreign booking calls the tracker step wherever it lives then. `feature/the-gate-refuses-release-approve` touches `release-approve`, not `runRelease`; check for overlap at merge time.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
