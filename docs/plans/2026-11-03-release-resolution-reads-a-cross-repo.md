# Release resolution reads a cross-repo `→ owner/repo#N` as a PR of this repository

> A plan whose highest-numbered PR lives in another repository cannot be released, because release resolution looks that PR number up in this repository.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3081
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3082 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/release-pr-reads-local-references`
- **Started:** 2026-11-04, Jan Wloka, `bug/release-tag-contains-every-local-pr`

## Changelog

- `plot-deliver.sh --release` and `plot-reconcile-scan.sh` section 6 resolve a plan's release from this repository's PRs only, through one domain rule. A plan whose slices span two repositories resolves to a version, the tag must contain every local PR, and a plan whose PRs are all in other repositories is booked Released with a named reason.

<!-- Board impact: none. `plot-plan-meta.sh` keeps `prs` and `deferred_prs` unchanged, so the board's cards (`board.ts:2707`), `ApproveButton.tsx:71` and scan section 2 do not move. The release rule reads `branchClaims` instead. -->

## Motivation

A plan with slices in two repositories stays at Delivered. Example (issue #3081, Plot 2.30.0, Bitbucket, `CI: jenkins`):

```markdown
- `feature/x` (this repo) → #33 — …
- `feature/x-docs` (other-repo) → owner/other-repo#280 — …
```

There is one plan parser, `plot-plan-meta.sh`. Its `extract_prs` (`plot-plan-meta.sh:1048-1054`) matches `→ owner/repo#N` and keeps only `N`, and its emitter sorts `prs` ascending and drops a duplicate number (`:663`, `sorted_insert` at `:396-401`). Both release sites read that list and take its last element, which is the HIGHEST number, not the last line of the plan:

- `--release`: `plot-deliver.sh` is a 13-line launcher that runs `board/plot-deliver.mjs`. The PR is chosen by `releasePr(prs, deferredPrs)` in `packages/domain/src/rules/release-tag.ts:29-32`, called at `packages/board/src/server/entry/deliver.ts:806`. The refusal `last PR (#280) carries no mergeCommit` comes from `deliver.ts:835`.
- Scan section 6: `plot-reconcile-scan.sh:3481` takes `last_pr="${prs##*,}"` and asks `plot-host.sh pr-state 280` in this repository. This is an undeclared shell copy of `releasePr`, and it ignores deferral: the scan reads no `deferred_prs` (`:663-666`).

In the issue's example 280 > 33, so the foreign PR wins on size. The scan prints `PR #280 has no merge commit → cannot resolve`, and `--release` refuses with the same reason, although #33 merged and `v0.1.0` is the first tag that contains it. Delivery works on the same plan: `plot-impl-status.sh:137` and `:252-258` read a qualified reference as another repository's.

The defect has three more shapes on origin/main:

- **Number collision.** A local `→ #33` and a foreign `→ other/repo#33` become one entry `33`.
- **Foreign deferral.** A deferred `→ other/repo#33` puts `33` into `deferred_prs`, and `releasePr` drops the shipped local #33.
- **Wrong tag.** `releaseTag` checks one merge commit. A plan with local #50 (merged late) and #60 (merged first) resolves to the first tag that contains #60, which can precede the tag that contains #50.

The defect blocks the per-plan release route: `skills/plot-release/SKILL.md` step 5b (one `--release` call per plan), the repair route of #3071 (`plot-deliver.mjs --release <tag> <slug>`), and a per-plan release after #3078. It does not block the sprint finish: `finishRelease` (`packages/board/src/server/entry/release-finish.ts:104`) books by sprint scope and resolves no PR per plan. `runRelease` refuses `PLOT_UNATTENDED=1` (`deliver.ts:791-795`), so the fixed route always has a person.

Workaround today: a hand-written `State: Released` record with one `plot-state-receipt.sh --unowned` receipt per plan.

## Design

### Approach

#### Local references

**Local means unprefixed (decided).** A reference with no `owner/repo` prefix is this repository's. Every `owner/repo#N` is foreign, including one that names this repository. `branchClaims` (`packages/domain/src/rules/cross-repo-reference.ts:56`, `SliceReference.repo === ''`) and delivery (`plot-impl-status.sh:137`) already use this rule. The release compares no remote, and has no fork rule. On origin/main no plan under `docs/plans/` qualifies its own PRs.

**The qualifier comes from `branchClaims`, and deferral from the plan record (decided).** `branchClaims` returns one `{ branch, reference: { repo, number } | null }` row per PR a claim line names, deduplicated by `repo#number`. Deferral is per branch: `PlanRecordBranch.deferred` (`packages/domain/src/ports/plan-store.ts:89`), which the parser sets from the branch line or its slice heading (`plot-plan-meta.sh:1485-1489`). A reference is deferred when its branch is deferred. `plot-plan-meta.sh` gains no field, so the shell does not grow and the plan-store corpus, `plan-store-fixture.ts` and `plan-store-shell.test.ts` do not change. A PR outside every claim line (an unread list item) counts in `prs` but is not release evidence.

#### One release rule

`releasePr` in `packages/domain/src/rules/release-tag.ts` changes. It takes the references with their repository and deferral, and answers one of:

- `local` with every non-deferred unprefixed PR number;
- `all-foreign` with the foreign repositories, where every non-deferred claim row names a foreign reference;
- `none`, where no non-deferred row names a PR, or a non-deferred branch names no PR at all.

A non-deferred branch with no annotation keeps today's refusal (`names no '→ #N' annotation`), even when another branch names a foreign PR, so an unannotated local branch never reads as `all-foreign`. Its only caller is `deliver.ts:806`. The function keeps its name and its TSDoc states the new contract.

#### Release tag

**The tag must contain every local PR (decided).** The release asks the host for each local PR's state. Any local PR with no merge commit refuses `no-merge-commit`, naming that PR. The release resolves the tag from the local PR that merged last, by the host's `mergedAt` (`PrLookup.mergedAt`, `packages/domain/src/ports/host.ts:44`), never by the highest number. `releaseTag` then checks that the tag contains the merge commit of every non-deferred local PR, read through `Refs.tagsContaining`, and otherwise refuses `tag-misses-pr`, naming the PR and its first containing tag. The reading gains one row per local PR (number, merge commit, `mergedAt`, containing tags); `lastPr` remains the PR the tag came from. This adds one host call per extra local PR, and a plan with one local PR costs what it costs today.

#### All-foreign plans

**An all-foreign plan gets a named outcome (decided).** `--release` books it Released with the reason `all-prs-foreign`, asks no host and reads no tag. The `Released:` record names the version the release names and today's date, because no tag date applies. The state receipt records the reason and the foreign repositories. The booking runs the same record and tracker step as a resolved booking. Scan section 6 reports such a plan with its own finding (`shipped in other repositories: <repos>`), with `consider: /plot-release`, and never `add → #N`.

#### Scan section 6

Section 6 asks the domain through one bundle call per sweep and keeps no copy of the rule. `plot-reconcile-scan.sh` passes the delivered plan files that are not docs/infra to one `node board/plot-release-chain.mjs` call. The bundle reads each plan, applies `releasePr` and `releaseTag` with the same readings `--release` gathers, uses the existing chain resolution for a merge commit outside the clone, and prints one line per plan: shipped in a tag, unreleased, all foreign, or a refusal by name. The shell formats those lines. `last_pr="${prs##*,}"`, the per-plan `plot-host.sh pr-state` call, the `cat-file` check and the `git tag --contains` arm (`:3481-3523`) leave the shell, so the section shrinks and `scripts/check-shell-lines.sh` passes. The `PR_SOURCE=off` arm stays in the shell and calls nothing. Section 6 and `--release` then agree on a deferred highest PR, which they do not on origin/main. `plot-release-chain.mjs resolve` keeps its interface.

#### Scope

**Commit-hash slice lines stay out of scope.** Neither `releasePr` nor section 6 reads `→ commit <sha>` or `owner/repo@sha` today, and no reported plan needs it. A branch whose only evidence is a local commit has no PR reference, so it keeps today's `none` refusal and never reads as `all-foreign`. A foreign `owner/repo@sha` is never passed to `git tag --contains`.

**Not changed:** `prs` and `deferred_prs` in the parser output, the board's `#280` card link (`board.ts:2707`, an existing defect), and `finishRelease`.

### Tests

Each case fails on origin/main unless the list says otherwise.

`packages/domain/test/release-tag.test.ts`:

- `#33` plus `other/repo#280` answers local `[33]` (today `'280'`).
- `#33` plus `other/repo#33` answers local `[33]`.
- `#33` plus a deferred `other/repo#33` answers local `[33]` (today `''`).
- Only foreign references answer `all-foreign` with the repositories.
- A foreign reference plus an unannotated non-deferred branch answers `none`.
- A foreign number lower than the local one answers the local one (regression: passes before and after).
- `releaseTag`: PR #60 merged before #50, and the tag of #60 does not contain #50, refuses `tag-misses-pr` naming #50.

`test/reconcile/deliver-release.test.mjs`. Its `gh` stub ignores `--repo` and answers every number merged, so each new test marks the foreign number closed:

- `→ #33` plus `→ owner/other-repo#280`, `GH_STUB_CLOSED=280`, tag `v0.1.0`: asserts `PR #33 merged` and `Released: … v0.1.0`.
- The same number in both repositories, and a deferred foreign number equal to the shipped local one.
- An all-foreign plan: booked Released with `all-prs-foreign`, no `gh pr view` call, the receipt names the reason.
- PR #60 merged before #50, both local: refuses `tag-misses-pr` and writes nothing. The stub gains a per-number merge commit and `mergedAt`.

`test/reconcile/scan.test.mjs` (section 6, including `runSection6Bitbucket` at `:4467`):

- The two-repository plan: the host stub answers #33 merged inside `v0.1.0`; the section prints `shipped in v0.1.0` and asks `pr-state` for 33 only.
- On Bitbucket, where `runSection6Bitbucket` answers no merge commit: the finding names `PR #33` and never `#280`.
- An all-foreign plan prints the new finding, not `add → #N`.
- A deferred highest PR: section 6 and `--release` name the same PR.
- PR #60 merged before #50: the section reports `tag-misses-pr`.

### Order and siblings

- #3071 (`bug/release-approve-tells-its-tracker`) moves the tracker step out of `runRelease` into `entry/release-tracker.ts`. The release arm here (`deliver.ts:797-860`) sits above that region. Whichever lands second rebases. The all-foreign booking calls the tracker step wherever it lives then.
- #3078 (`feature/release-finish-names-unbooked-plans`) makes `releaseFinish` book plans a shipped changeset names. It resolves no PR per plan, so it neither blocks this plan nor needs it.

### Open Questions

- [x] Does the local PR always carry the release, or can a foreign PR ship the plan? Decided: an unprefixed reference is local; a foreign PR never resolves a tag here; a plan with only foreign PRs is booked `all-prs-foreign`.
- [x] Which scripts besides section 6 and `--release` take "the last PR"? A search of `skills` and `packages` on origin/main for `prs##*,`, `last_pr`, `.prs[-1]` and `releasePr(` finds two sites: `plot-reconcile-scan.sh:3481` and `deliver.ts:806`. `plot-release-chain.mjs resolve` receives the number from the scan.

## Slices

### Local release references

- `bug/release-pr-reads-local-references` — `releasePr` reads `branchClaims` references with their branch's deferral, answers `local`, `all-foreign` or `none`, and `--release` books an all-foreign plan Released with `all-prs-foreign` and no tag lookup <!-- builds: releasePr over repository-qualified references; the all-prs-foreign booking --> → #3087

### Release tag covers every local PR

- `bug/release-tag-contains-every-local-pr` — `--release` resolves the tag from the local PR that merged last by `mergedAt`, and refuses `tag-misses-pr` when that tag does not contain every non-deferred local PR's merge commit <!-- builds: releaseTag over every local PR --> <!-- waits: bug/release-pr-reads-local-references -->

### Scan asks the release rule

- `bug/scan-release-asks-the-domain` — scan section 6 asks `releasePr` and `releaseTag` through one `plot-release-chain.mjs` call per sweep, reports an all-foreign plan with its own finding, and drops its shell copy of the rule <!-- builds: a batched release verb on plot-release-chain.mjs; section 6 without last_pr --> <!-- waits: bug/release-tag-contains-every-local-pr -->

## Notes

- Created from issue #3081 by `/plot-idea`. Nothing was written to the tracker.
- Amended after panel round 1 (`.plot/panels/2026-11-03-release-resolution-reads-a-cross-repo/panel.md`).
