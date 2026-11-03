# Testability juror — release-resolution-reads-a-cross-repo (#3081, plan PR #3082)

Position: amend

The defect is real and the fix direction is right. The test plan is one clause ("with a test on a two-repository plan") and names no file, no assertion and no stub change. With the existing stubs on origin/main, the obvious two-repository fixture passes before the change, so the named test would not prove the fix.

## Findings

1. **The plan names no test file.** The tests that hold this behaviour on origin/main are:
   - `test/reconcile/scan.test.mjs` — section 6: `scan: a delivered plan with no PR annotation is unresolvable, not silent` (:684), the GitHub section-6 fixtures (:4196–:4444), and the Bitbucket helper `runSection6Bitbucket` (:4467) with `scan: the unresolvable finding names the configured host CLI` (:4500).
   - `test/reconcile/deliver-release.test.mjs` — `--release`: `a plan with no → #N annotation is refused` (:167), `a deferred last slice with a closed PR releases from the earlier merged PR` (:208), `a plan whose only PR-bearing slice is deferred is refused` (:225).
   - `packages/domain/test/release-tag.test.ts` — `releasePr` unit cases (:6–:18).
   - If `plot-plan-meta.sh` gains a field: `packages/domain/corpus/plan-store.corpus.test.ts` (`FIELDS` table, `deferredPrs` at :48), `packages/domain/src/adapters/plan-store/plan-store-fixture.ts`, `packages/domain/test/plan-store-shell.test.ts`.

2. **The deliver-release stub makes a naive fixture pass on origin/main.** `deliver-release.test.mjs:62–71`: the `gh pr view` stub answers EVERY number as `MERGED` with `GH_STUB_SHA`, and ignores `--repo`. A plan `→ #33` + `→ owner/other-repo#280` resolves #280 to the shipped sha and releases today. The test fails before the change only if it sets `GH_STUB_CLOSED=280` (this repository's #280 has no merge commit, as in the issue) and asserts `PR #33 merged` in the output, the way :218 asserts `PR #1423`.

3. **"Last" means "highest number", and the fixture must respect that.** Both callers read `plot-plan-meta.sh`'s `prs`, which it sorts ascending (`plot-plan-meta.sh:663`). Section 6 takes `${prs##*,}` (`plot-reconcile-scan.sh:3481`); `releasePr` takes the last element of the sorted list (`rules/release-tag.ts:29–32`, documented as "the highest PR number"). A fixture whose foreign number is LOWER than the local one passes on origin/main. The fixture must keep the issue's shape (foreign #280 > local #33). The plan text "take the last of the remaining PRs" reads as plan order; it must say "highest".

4. **`plot-deliver.sh --release` is a 13-line launcher.** The release PR is chosen in TypeScript: `packages/board/src/server/entry/deliver.ts:806` calls `releasePr(parsed.value.prs, parsed.value.deferredPrs)`. The plan does not name `releasePr` or its unit test, and its signature must change. That makes the domain unit test the cheapest fail-before test of the rule.

5. **There is one parser, not two.** The plan says "the awk parser in `plot-plan-meta.sh` and `plot-reconcile-scan.sh`". Section 6 reads `plot-plan-meta.sh` JSON (`plot-reconcile-scan.sh:662–664`, the section-6 read loop at :3448). `extract_prs` (`plot-plan-meta.sh:1048–1054`) matches `owner/repo#N` and keeps only `N`. One new field there feeds both callers.

6. **Section 6 and `releasePr` already disagree on deferred PRs.** Section 6 takes the last of all `prs`; `releasePr` skips `deferredPrs`. If section 6 adopts the domain rule (recommended), its deferred behaviour changes too, and that needs its own scan test. If section 6 duplicates the filter in shell, CLAUDE.md "A Shell Script Asks The Domain" requires a corpus test pairing it with `releasePr`, and `scripts/check-shell-lines.sh` charges the added lines. The plan leaves this as an open point; a Sonnet agent needs the answer before it can write the tests.

7. **A number-only foreign list collides.** If the new field is a list of foreign numbers (shape of `deferred_prs`), a plan with local `→ #33` and `→ owner/other#33` filters out its own #33. A required test case: the same number in both repositories still releases from this repository's #33. `branchClaims` (`packages/domain/src/rules/cross-repo-reference.ts:56`) already returns `{repo, number}` with `repo: ''` for this repository; the plan does not mention it.

8. **"Not this repository" needs an identity read the fixtures cannot supply.** `deliver-release.test.mjs` clones from a local bare path, and its stub answers `gh repo view` with `main` only (:72–73). `plot-impl-status.sh:252–258` treats ANY `owner/repo#` prefix as another repository and does no comparison. The rule "a prefix means foreign" agrees with impl-status, needs no remote read, and is testable with the current fixtures. The plan's wording ("where owner/repo is not this repository") implies a remote comparison, with fork and rename cases, and none of those has a named test.

9. **The all-foreign case has no named refusal.** The plan says it "reads as no PR annotation". `deliver.ts:830` then refuses with "names no '→ #N' annotation", which is false for a plan that carries two annotations. The scan line (`plot-reconcile-scan.sh:3460`) advises "add → #N to its Branches section", which is also wrong for this plan. Both need a distinct message and a test each.

10. **The Bitbucket arm cannot show "shipped in" in the current scan fixture.** `runSection6Bitbucket` (`scan.test.mjs:4467–4476`) answers every `pr view` with no `mergeCommit`, so every plan reaches `cannot resolve`. A Bitbucket two-repository test there can assert only that the finding names `PR #33` and never `#280`. That still fails on origin/main (the finding names #280), so it is a valid fail-before test, but the plan must say which assertion it makes.

## Amendments required

1. Name the test files in the slice line: `test/reconcile/scan.test.mjs`, `test/reconcile/deliver-release.test.mjs`, `packages/domain/test/release-tag.test.ts`, and the plan-store corpus/fixture/shell tests if `plot-plan-meta.sh` gains a field.
2. State the fixture: local `→ #33` merged and tagged `v0.1.0`; foreign `→ owner/other-repo#280` with `GH_STUB_CLOSED=280` (deliver-release) so origin/main refuses with `no mergeCommit` for #280. Assert `PR #33 merged` and `Released: … v0.1.0` after.
3. Add these cases, each named: the same number in both repositories; every annotation foreign (named refusal / named scan line, not "add → #N"); a foreign number lower than the local one (regression, passes before and after — say so).
4. Replace "last" with "highest number" in Approach and the slice line.
5. Correct Motivation: section 6 has no parser of its own; `--release` chooses in `releasePr` (`rules/release-tag.ts:29`), called at `deliver.ts:806`.
6. Decide the shared-rule question in the plan: section 6 asks `releasePr` through a bundle (one domain rule, no corpus pair), or a declared shell duplicate with a corpus test in `packages/domain/corpus/`. State that section 6 then also skips deferred PRs, with a scan test.
7. State the rule for "this repository": recommended, any `owner/repo#N` prefix is foreign, matching `plot-impl-status.sh:252` and `SliceReference.repo === ''`.

## Decisions for a person

- Whether a self-qualified annotation (`→ plot-pm/plot#33` in plot-pm/plot) must count as this repository. With "a prefix means foreign" it reads as foreign and the plan refuses by name; supporting it needs a remote-identity read and fork/rename tests.
- Open question 1 (can a foreign PR be the one that ships the plan): if yes, the all-foreign refusal is wrong and release needs a different source. This is a product decision, not an agent's.

## Ran versus read

Ran (read-only): `gh issue view 3081`; `git show origin/main:` of `plot-reconcile-scan.sh`, `plot-deliver.sh`, `plot-plan-meta.sh`, `plot-impl-status.sh`, `packages/board/src/server/entry/deliver.ts`, `packages/domain/src/rules/release-tag.ts`, `packages/domain/src/rules/cross-repo-reference.ts`, `plan-store-shell.ts`, `test/reconcile/deliver-release.test.mjs`, `test/reconcile/scan.test.mjs`, `packages/domain/test/release-tag.test.ts`, `packages/domain/corpus/plan-store.corpus.test.ts`; `git grep` for callers and tests.

Not run: no test suite, no script. The fail-before claims in findings 2, 3 and 10 come from reading the stubs and the sort, not from executing a fixture.
