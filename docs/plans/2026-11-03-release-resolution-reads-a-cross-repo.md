# Release resolution reads a cross-repo `→ owner/repo#N` as a PR of this repository

> A plan whose last slice lives in another repository cannot be released, because release resolution looks that PR number up in this repository.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3081
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-reconcile-scan.sh` section 6 and `plot-deliver.sh --release` pick the release PR from this repository's annotations only; a plan whose slices span two repositories resolves to a version.

<!-- Board impact: none expected. The plan format does not change; only the choice of release PR does. Confirm when designing. -->

## Motivation

A plan with slices in two repositories stays at Delivered. Example (issue #3081, Plot 2.30.0, Bitbucket, `CI: jenkins`):

```markdown
- `feature/x` (this repo) → #33 — …
- `feature/x-docs` (other-repo) → owner/other-repo#280 — …
```

`plot-reconcile-scan.sh` section 6 takes the last PR number (`last_pr="${prs##*,}"`, around line 3481), and the parser has already dropped the `owner/repo` prefix. `plot-host.sh pr-state 280` asks this repository's host, which holds a different PR or none. The scan prints `PR #280 has no merge commit → cannot resolve`, and `plot-deliver.sh --release v0.1.0 <slug>` refuses with the same reason. PR #33 is merged and `v0.1.0` is the first tag that contains it. `plot-impl-status.sh` resolves `owner/repo#N` in its own repository, so delivery works on the same plan and release does not.

Workaround today: a hand-written `State: Released` record with one `plot-state-receipt.sh --unowned` receipt per plan.

## Design

### Approach

Pick the release PR from this repository's annotations only. Skip every `→ owner/repo#N` where `owner/repo` is not this repository, and take the last of the remaining PRs. A plan whose annotations are all foreign has nothing to release here and reads as "no PR annotation", not "cannot resolve".

The same rule applies wherever `--release` picks its PR. `plot-release-chain.mjs resolve` receives the number the scan picked, so the choice must be made before that call.

Points to settle during design:

- Where the repository qualifier survives. The awk parser in `plot-plan-meta.sh` and `plot-reconcile-scan.sh` keeps only the number (`prs[++n_prs]`); the fix either carries the qualifier through or adds a separate list of this-repository PRs.
- How "this repository" is identified on GitHub and Bitbucket (`owner/repo` against the remote), including a fork or renamed remote.
- Whether the rule is shared with the TypeScript side (`rules/` in `packages/domain`) or duplicated in shell, in which case it joins the corpus tier (see CLAUDE.md, "A Shell Script Asks The Domain").
- That `plot-impl-status.sh` and the new release rule agree on what a cross-repo annotation means.

### Open Questions

- [ ] Does the last PR of this repository always carry the release, or can a foreign PR be the one that ships the plan?
- [ ] Which scripts besides section 6 and `plot-deliver.sh --release` take "the last PR"? Run a search before slicing.

## Slices

### Release PR selection

- `bug/release-resolution-skips-foreign-prs` — release resolution takes the last PR of this repository and ignores `owner/repo#N` annotations of other repositories, in the scan's section 6 and in `plot-deliver.sh --release`, with a test on a two-repository plan <!-- builds: this-repository release PR selection -->

## Notes

- Created from issue #3081 by `/plot-idea`. Nothing was written to the tracker.
