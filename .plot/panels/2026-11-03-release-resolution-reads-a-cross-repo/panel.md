# Panel — release-resolution-reads-a-cross-repo, round 1

Plan: `docs/plans/2026-11-03-release-resolution-reads-a-cross-repo.md` (PR #3082, issue #3081). Jurors: layering, safety, seams, testability. Code references verified against `origin/main` at `dfa59da98`.

## Positions

| Juror | Position |
|---|---|
| layering | amend |
| safety | amend |
| seams | amend |
| testability | amend |

Unanimous `amend`. No juror proposed `reject`, and every juror confirmed the defect: `plot-plan-meta.sh:1048-1054` drops the `owner/repo` prefix, and both release sites then ask this repository about a foreign number.

## Agreement

- All four found that `--release` chooses its PR in the domain: `plot-deliver.sh` is a 13-line launcher, and `releasePr` (`packages/domain/src/rules/release-tag.ts:29-32`) is called at `deliver.ts:806`. The plan named neither. Verified.
- All four found that "the last PR" is the highest number: the parser sorts `prs` ascending and drops a duplicate (`plot-plan-meta.sh:663`, `sorted_insert` at `:396-401`). Verified.
- layering, seams and testability found one parser, not two: section 6 reads `plot-plan-meta.sh` JSON (`plot-reconcile-scan.sh:662-666`). Verified.
- All four found that section 6 is an undeclared shell copy of `releasePr` that ignores deferral (`plot-reconcile-scan.sh:3481`). Verified: `plan_rows` carries no `deferred_prs`.
- All four found the number-only lists collide: a local `#33` and a foreign `other/repo#33` become one entry, and a deferred foreign `#33` drops a shipped local `#33`. Verified from `extract_prs` and `release-tag.ts:31`.
- All four found that `branchClaims` (`cross-repo-reference.ts:56`) already keeps the qualifier, with `repo: ''` for this repository, and that delivery (`plot-impl-status.sh:137`, `:252-258`) reads a qualified reference as foreign without a remote comparison. Verified.
- All four found that the all-foreign plan would reach the existing "no PR annotation" arm, whose advice `add → #N` (`plot-reconcile-scan.sh:3459-3461`) and refusal text (`deliver.ts:829-830`) are false for it. Verified.
- layering and seams closed Open Question 2: two sites take the last PR, `plot-reconcile-scan.sh:3481` and `deliver.ts:806`. Verified by `git grep`.

## Disagreements

- **What "this repository" means.** safety amendment 3 proposed comparing a qualified reference against `hostAndPathOfRemote(origin)`, with a `repository-unknown` refusal; layering, seams and testability proposed "unprefixed is local". The person decided for unprefixed: it matches delivery and `branchClaims`, and needs no remote read and no fork rule.
- **Where the qualifier comes from.** layering and safety allowed either a new parser field or `branchClaims`; seams preferred `branchClaims`. The plan reads `branchClaims` and takes deferral from `PlanRecordBranch.deferred` (`ports/plan-store.ts:89`), because a parser field grows the shell, which `scripts/check-shell-lines.sh` refuses unless the same change shrinks it. The plan-store corpus and fixtures therefore do not change.
- **The wrong-tag hole.** safety amendment 4 required every local PR in the tag; the other three did not raise it. The person decided for it: the tag comes from the latest-merged local PR by `mergedAt`, and a tag that misses a local PR refuses `tag-misses-pr`.
- **The all-foreign outcome.** layering and safety named a refusal; seams listed stay Delivered, book by scope, or book with a named version. The person decided: the scan reports it with its own finding, and `--release` books it Released with the reason `all-prs-foreign` and no tag lookup.

## Decisions by the person (jwloka)

1. Local means unprefixed. Every `owner/repo#N` is foreign, including one that names this repository. No remote parsing, no fork rule.
2. An all-foreign plan gets a named outcome: its own finding in section 6, and a `--release` booking with a named reason, recorded in the receipt.
3. The tag must contain every local PR. The release resolves the tag from the latest-merged local PR by `mergedAt` and refuses by name (`tag-misses-pr`) otherwise.

## Amendments applied

- `releasePr` named as the one rule; it reads references with repository and deferral, and its `prs` input from the parser stays unchanged so the board and section 2 do not move (layering 1, 2; safety 1, 2; seams 1, 2, 4).
- Section 6 asks the domain through one `plot-release-chain.mjs` call per sweep and drops `:3481-3523`, which fixes the deferred-PR disagreement and shortens the shell (layering 3; safety 6; seams 1; testability 6).
- Motivation corrected: one parser, "last" is highest number, `plot-deliver.sh` is a launcher, the refusal comes from `deliver.ts:835` (testability 4, 5; seams F3).
- Commit-hash slice lines stated out of scope; a commit-only local branch keeps today's refusal and never reads as all-foreign (seams 6).
- Named test files and fail-before cases, including the `gh` stub's `--repo` blindness and `GH_STUB_CLOSED=280` (testability 1-3; seams 7; safety 7; layering 6).
- Both open questions closed (layering 7; seams 8).
- Siblings named: #3071 on `deliver.ts`, #3078 on `releaseFinish`; the fixed route is the per-plan release, not the sprint finish (seams F10).
- One slice split into three branches: the selection rule, the tag check, and the scan call.

## Not adopted

- safety amendment 3 (remote comparison and `repository-unknown`): replaced by decision 1.
- safety D3 (an `upstream` remote for forks): no fork rule under decision 1.
- A Bitbucket remote parser (safety, seams D1): not needed under decision 1.
