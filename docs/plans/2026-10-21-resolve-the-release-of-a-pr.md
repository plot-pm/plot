# Reconcile: resolve the release of a PR merged into a deleted branch

> Section 6 of `plot-reconcile-scan.sh` cannot resolve the release of a PR that merged into a non-default branch deleted later, and blames the source branch; it should follow the destination branch's own merged PR to the default branch.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2215
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-reconcile` resolves the release of a delivered plan whose PR merged into a feature branch that was deleted later. It follows that branch's own merged PR to the default branch and reads the tag from that merge commit. When the chain breaks, it names the deleted destination branch and prints no fetch advice.

<!-- Board impact: none. The change is to one scan section's resolution logic and finding text; no plan format, template or layout field changes. -->

## Motivation

Measured 2026-10-21, read-only, against ewz-kus-portal (Bitbucket), main `01a6cf2ad`: PRs #3488, #3489 and #3490 merged into `feature/ewzkus-3518-sammelrechnungen`, which no longer exists. The scan reports their plans as `merge commit … not in this clone → cannot resolve`. That branch's own PR #3491 merged into `develop` as `651cb9be3724`, and `git tag --contains 651cb9be3724` places it in v5.23.2213. The release is therefore knowable.

Since #2201 (plan `2026-10-20-merge-commit-not-in-this-clone`), `skills/plot/scripts/plot-reconcile-scan.sh:3408` says the commit is unreachable because the *source* branch was deleted. That cause is wrong: PRs #3644 and #3705 had their source branches deleted and their merge commits are in the clone. The commit is missing when the PR's *destination* branch is not the default branch and was deleted later, so the merge commit sits on a ref no clone holds. The two cases print the same line today.

## Design

### Approach

When a PR's destination branch (`destination.branch` in the Bitbucket payload; `base` in `plot-host.sh pr-list` rows) is not the default branch, the scan follows the chain:

1. Find the merged PR whose source branch is that destination branch.
2. If that PR merged into the default branch, resolve the tag from its merge commit with `git tag --contains`.
3. If that PR merged into another non-default branch, repeat from step 1, with a depth bound and a visited set so a cycle ends the walk.
4. If no merged PR is found, or the chain ends outside the default branch, the finding names the deleted destination branch and prints no fetch advice.

The unreachable line at `:3408` stops naming the source branch. It names the destination branch when that is the cause.

All host reads go through `plot-host.sh`; the scan adds no direct `gh` or `bb` call. `scripts/check-shell-lines.sh pr` ratchets the shipped shell, so the change must not grow the line count against its merge base.

### Open Questions

- [ ] Does `plot-host.sh pr-state` return the destination branch on both backends, or only `pr-list` (`base`)? If only `pr-list`, the chain walk needs the list call; measure its cost against the scan's request budget before choosing.
- [ ] How does the scan find the PR whose *source* branch is the deleted destination branch: a `pr-list --state merged` filter by head, or a lookup the plan index already holds? The index supplies `MERGED` answers only (see *A Decision Reads The Index*).
- [ ] Should the walk live in the scan (shell) or in the domain, with the scan calling a bundle? `docs/shell-and-domain.md` rules on a rule that runs once per operator command; section 6 runs once per delivered plan.
- [ ] What does the finding say when the chain breaks, and does it separate "branch deleted, no merged PR found" from "merged PR found, merge commit also missing"?
- [ ] Does GitHub need the same follow? A merge into a feature branch on GitHub leaves the commit on that branch's ref, which a deleted branch also drops, but GitHub's `refs/pull/N/merge` may still carry it. Measure before widening the change.

## Done when

- [ ] A fixture with PR A merged into branch B (deleted), and PR B merged into the default branch with a tagged merge commit, resolves A's plan to that tag.
- [ ] A fixture where the chain breaks names the deleted destination branch and prints no `git fetch --tags origin` advice.
- [ ] A fixture with a deleted *source* branch and a merge commit present in the clone still resolves directly; the finding no longer blames the source branch anywhere.
- [ ] A cyclic or over-deep chain ends with a named finding, not a loop.
- [ ] The GitHub `--no-fetch` fetch advice from #2201 is unchanged (over-correction guard).
- [ ] `scripts/check-shell-lines.sh pr` shows zero net growth.

## Slices

### Fix

- `bug/resolve-the-release-of-a-pr` — section 6 follows a non-default destination branch to the default branch and names the deleted destination branch when the chain breaks

## Notes

- Drafted from tracker issue #2215. Nothing is written to the tracker.
- Follows #2155 and #2201. Blocks release 2.28.0.
