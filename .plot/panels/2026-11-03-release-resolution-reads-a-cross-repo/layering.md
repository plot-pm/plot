# Juror: layering

Position: amend

## Summary

The defect is real and the slice fixes it in the right two places, but the plan does not know that the rule already lives in the domain. `releasePr` in `packages/domain/src/rules/release-tag.ts:30` picks the release PR for `plot-deliver --release` today. Section 6 of `plot-reconcile-scan.sh:3481` holds an undeclared shell copy of the same rule, and the two copies already disagree on deferred PRs. The plan lists "share with the domain or duplicate in shell" as an open question. That question has one answer under CLAUDE.md: change `releasePr` once, and make section 6 ask the domain instead of keeping its copy. An unattended agent that reads the slice as written ("in the scan's section 6 and in `plot-deliver.sh --release`") will most likely edit two copies.

## Findings

### Where the rule is decided today (origin/main)

1. `plot-plan-meta.sh:1048-1054` (`extract_prs`) matches `→ owner/repo#N` and keeps only `N` (`sub(/^.*#/, "", p)`). The header at `plot-plan-meta.sh:180-186` states this as the contract: "The repo part is matched but not retained". `deferred_prs` (`:1052`, header `:187-190`) drops the qualifier too.
2. `plot-plan-meta.sh:663` sorts `prs` numerically and makes it unique. So "the last PR" is the HIGHEST number, not the last in document order. In the issue's example, 280 > 33, so the foreign PR wins on size, not on position. A plan whose foreign PR number is lower than the local one is not affected today.
3. `plot-reconcile-scan.sh:663-666` builds `plan_rows` from the parser's JSON and drops `deferred_prs`. `:3481` takes `last_pr="${prs##*,}"`. This is a shell copy of `releasePr` that ignores deferral.
4. `packages/board/src/server/entry/deliver.ts:806` calls `releasePr(parsed.value.prs, parsed.value.deferredPrs)` through `planStore.readPlan`, which reads the same parser output (`plan-store-shell.ts:162-163`). `plot-deliver.sh` is a 13-line launcher for `board/plot-deliver.mjs`; it decides nothing. So the `--release` path is already domain code; only its input lacks the qualifier.
5. `plot-release-chain.mjs resolve` (`packages/board/src/server/entry/release-chain.ts`) takes the PR number as an argument and never picks it. The plan states this correctly.
6. `packages/domain/src/rules/cross-repo-reference.ts:56` (`branchClaims`) already keeps the qualifier: `SliceReference.repo` is `''` for this repository and `owner/repo` for another. `plot-impl-status.sh:66` reads claims through `board/plot-slice-claims.mjs` → `branchClaims`. `plot-impl-status.sh:137` and `:252-258` treat a reference as local exactly when it carries no qualifier. They do NOT compare `owner/repo` with the remote.

### Claims in the plan checked against the code

- "around line 3481": true (`plot-reconcile-scan.sh:3481`).
- "The awk parser in `plot-plan-meta.sh` and `plot-reconcile-scan.sh` keeps only the number (`prs[++n_prs]`)": half true. The scan has no PR parser of its own; it reads `plot-plan-meta.sh` JSON (`:662`). `prs[++n_prs]` is in `plot-plan-meta.sh:1052` and `:1464` only.
- "`plot-deliver.sh --release` picks the release PR from this repository's annotations only" (Changelog, Approach): the pick is `releasePr` in the domain. The plan never names `releasePr` or `release-tag.ts`.
- "Whether the rule is shared with the TypeScript side ... or duplicated in shell": the rule is already shared in TypeScript and already duplicated in shell. The duplicate is undeclared and has no corpus test (`git grep releasePr` finds only `deliver.ts` and `release-tag.test.ts`).
- "`plot-impl-status.sh` resolves `owner/repo#N` in its own repository": true (`plot-impl-status.sh:252-258`, via `board/plot-pr-state.mjs`).
- Open question "Which scripts besides section 6 and `plot-deliver.sh --release` take the last PR?": I searched `skills` and `packages` for `prs##*,`, `.prs[-1]`, `.prs | last`, `prs.at(-1)` and `releasePr(`. The only two sites are `plot-reconcile-scan.sh:3481` and `deliver.ts:806`. The open question can close.

### Layering consequences

- The existing duplicate already drifts: for a plan whose highest PR is deferred, section 6 asks about the deferred PR and `plot-deliver --release` asks about the next one. The plan's fix, applied to both copies, adds a second rule (skip foreign) to both and keeps the drift. A corpus test that compared them would fail today on the deferred case.
- "This repository is identified by `owner/repo` against the remote, including a fork or renamed remote" introduces a third reading of "local". `branchClaims`, `crossRepoReferences` and `plot-impl-status.sh` all read "local" as "no qualifier". The plan's own last design point asks that impl-status and the release rule agree; the only reading that agrees with no new code is "an unqualified reference is local". Comparing against the remote adds a host/remote dependency to a pure rule, needs a remote read at every caller, and is untested on Bitbucket. `git grep` finds no plan in this repository that qualifies its own PRs (`→ plot-pm/plot#`), so the remote comparison buys nothing measured.
- `prs` is unique by number. A plan that names `#280` here and `other/repo#280` there gets one entry. Any fix that filters after the parser's dedupe cannot tell them apart. The qualifier must survive in the parser output (or the rule must read `branchClaims`), not be reconstructed later.
- Shell-lines ratchet (`scripts/check-shell-lines.sh`, no allowance): any added `jq` filter or awk branch in section 6 or the parser costs lines that the same change must remove elsewhere. Replacing `:3481` with a call to the domain lets section 6 shrink; adding a "skip foreign" filter in shell makes it grow and keeps a duplicate.
- Cost rule (CLAUDE.md, "A Shell Script Asks The Domain"): `plot-reconcile-scan.sh` runs once per operator command, and section 6 already spawns `node plot-release-chain.mjs` per plan and `plot-released-labels.mjs` once. Calling a bundle for the pick is within the rule. A per-plan spawn over ~82 delivered plans is about 3 s; one batched call over `plan_json` costs one start.

### Failure modes

- All annotations foreign: the plan says the plan "reads as no PR annotation". The scan's arm at `:3459-3465` then counts a finding on every sweep and advises "add → #N to its Branches section", which is wrong advice for work that lives in another repository. `deliver.ts:829` refuses with "names no '→ #N' annotation". So such a plan can never reach Released, and the sprint goal (zero interventions) is not met for it. This needs a named outcome, not the existing arm.
- Local PR deferred, foreign PR not: with the fix, the pick is `''` and the plan falls into the same all-foreign arm. Same decision as above.

### Can an unattended Sonnet agent build the slice?

Not safely as written. Missing decisions: (a) where the qualifier survives (parser field vs `branchClaims`); (b) that `releasePr` is the one rule to change; (c) how section 6 asks it; (d) the definition of "this repository"; (e) what an all-foreign plan reports and whether it may be released. (d) and (e) are decisions for a person; the rest the plan can settle now.

### Test plan

"a test on a two-repository plan" fails before and passes after only if the foreign PR number is higher than the local one (finding 2). The plan does not say so. No test covers the deferred-and-foreign combination, the same number in two repositories, or the agreement of section 6 with `releasePr`.

## Amendments required

1. Name `releasePr` (`packages/domain/src/rules/release-tag.ts:30`) as the one rule that changes. It takes references that keep their repository (for example `SliceReference[]` plus the deferred set) and returns the highest unqualified, non-deferred PR. Update its TSDoc and `release-tag.test.ts`.
2. Carry the qualifier to the rule. Either add a parser field to `plot-plan-meta.sh` (for example `foreign_prs`, or qualified strings) and map it in `plan-store-shell.ts`/`ports/plan-store.ts`, or have the rule read `branchClaims` and the parser's deferral. State which. Do not reconstruct the qualifier after the parser's numeric dedupe.
3. Remove the shell copy at `plot-reconcile-scan.sh:3481`. Section 6 asks the domain for the release PR, for example a `pick` verb on `plot-release-chain.mjs` that reads the plan JSON for all delivered plans in one call. This fixes the existing deferred-PR drift and lets the shell-lines ratchet pass by shrinking. If the author keeps a shell copy instead, declare it, add a corpus test against `releasePr` under `packages/domain/corpus/`, and pay the ratchet in the same change.
4. Define "this repository" as "a reference with no `owner/repo` qualifier", the reading `branchClaims` and `plot-impl-status.sh:137` already use. Drop the remote comparison, or move it to its own plan with a measured case.
5. Name the outcome for a delivered plan with no local, non-deferred PR, in both the scan and `--release`, with its own refusal or finding text that does not advise "add → #N".
6. Tests: a two-repository plan whose foreign PR number is higher than the local one (fails before, passes after) in `release-tag.test.ts` and in a scan test; the deferred-highest case asserting section 6 and `--release` pick the same PR; the same number in two repositories; the all-foreign case.
7. Close the two open questions: the search above finds only the two sites, and "the last PR" is the highest-numbered one, not the last in document order.

## Decisions for a person

- Whether a plan with no local PR (all work in another repository) may reach Released, and by which record, or stays Delivered with a named non-blocking note.
- Whether a self-qualified reference (`→ plot-pm/plot#N` inside plot) counts as local. Amendment 4 says no; that keeps agreement with delivery.

## What I ran versus read

Ran (read-only): `gh issue view 3081`; `git show origin/main:` of `plot-reconcile-scan.sh`, `plot-plan-meta.sh`, `plot-impl-status.sh`, the `plot-deliver.sh` launcher, `release-tag.ts`, `deliver.ts`, `release-chain.ts`, `cross-repo-reference.ts`, `plan-store-shell.ts`, `check-shell-lines.sh`; `git grep` over `skills`, `packages` and `docs/plans` for last-PR selection sites, `releasePr` callers and self-qualified references. Not run: any test suite, the scan, `--release`, or a host call. The deferred-PR drift between section 6 and `releasePr` is read from the code, not executed.
