# Reconcile: merge commit not in this clone after the advised fetch

> Section 6 of `plot-reconcile-scan.sh` (delivered, shipped but plan not released) advises `git fetch --tags origin` for a merge commit the clone lacks; on a Bitbucket repository the fetch does not bring the commit, so the advice is false.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2155
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2191 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/merge-commit-not-in-this-clone`
- **Delivered:** 2026-10-20
- **Released:** 2026-10-22, v2.28.0

## Changelog

- `plot-reconcile` no longer advises a fetch that cannot bring the merge commit. It either finds the commit after the advised fetch or names why the commit is unreachable.

<!-- Board impact: none. The change is to the text of one scan finding; no plan format, template or layout field changes. -->

## Motivation

Field test on 2026-10-20 against ewz-kus-portal (Bitbucket): `plot-reconcile-scan.sh` reported for PRs #3488, #3489 and #3490 `merge commit a528921d88dd / e2a46860aa36 / 82b71e40d14b not in this clone` and advised `git fetch --tags origin`. After a fresh fetch, `git cat-file -t a528921d88dd` still failed. The clone is not shallow.

The advice at `skills/plot/scripts/plot-reconcile-scan.sh:3401` is printed for three populations (the comment at `:3391` names them): `--no-fetch` with PRs on, a merge commit outside the local refspec or a shallow clone, and a PR merged outside the host's merge button. A fetch helps the first and the shallow case only. For the other cases it sends the operator to a command that changes nothing, and the finding reads as a clone problem when the commit may be on no fetched ref.

## Design

### Approach

Not yet decided. The plan starts from two open facts, to be measured before a fix is chosen:

1. Why the commit is absent after a full fetch on Bitbucket. Candidates: the host reports a merge commit that lives on a ref the default refspec does not fetch (for example a pull-request ref), or the host reports a hash of a commit it later rewrote or dropped.
2. Which of the three populations in the comment at `:3391` a given finding belongs to. The scan can tell `--no-fetch` and a shallow clone (`git rev-parse --is-shallow-repository`) from the rest without a host call.

The expected shape, from the issue: the advice is true or absent. Where a fetch can help, the finding keeps `git fetch --tags origin`. Where it cannot, the finding says why the commit is unreachable and prints no fetch advice.

### Open Questions

- [x] Which ref carries the Bitbucket merge commit, and does a refspec addition fetch it, or is it unreachable by design? **Unreachable by design.** Bitbucket Cloud has never exposed a `refs/pull-requests/*` equivalent of GitHub's `refs/pull/N/{head,merge}`. On GitHub, a merge/squash/rebase result always lands on the base branch ref, covered by the default refspec. On Bitbucket, once a PR's source branch is deleted after a squash/merge — the common case, and what `plot-host.sh pr-merge --delete-branch` itself does — the merge commit was never transmitted to any clone on any ref. No refspec addition can fetch an object the host's git transport never sent.
- [x] Does the same false advice appear elsewhere (`grep` for `git fetch --tags origin` in the scan and `packages/domain`)? **No.** `git grep -n "fetch --tags origin" -- skills packages test` returns exactly one shell-code site both before and after this fix: `skills/plot/scripts/plot-reconcile-scan.sh`. `skills/plot-reconcile/` quotes no fetch advice (checked directly; no hits).
- [x] Does the finding need a distinct wording per population, or one wording that names the unknown? **One wording, branched two ways on `PR_SOURCE`** (already computed, no new host call). `--no-fetch` and a shallow clone both resolve to "a fetch would help" regardless of backend, so they keep `git fetch --tags origin, then re-run`. A true Bitbucket-ref gap gets its own line naming the reason. The population split in the code comment stays descriptive; the finding's wording only needs to split on whether a fetch can help, which collapses to backend (Bitbucket vs. everyone else) because GitHub's merge/squash/rebase result is always reachable via the base branch ref.

## Done when

- [x] `skills/plot/scripts/plot-reconcile-scan.sh` section 6 advises `git fetch --tags origin` only where a fetch can help; a Bitbucket-sourced unreachable merge commit (`PR_SOURCE = bb`) gets a line naming why instead.
- [x] `test/reconcile/scan.test.mjs` covers both populations: a Bitbucket fixture asserting the fetch line is absent and the reason line is present, and a GitHub `--no-fetch` fixture asserting the fetch line is still present (over-correction guard). Both pass; the pre-existing section-6 tests (5 of 5) still pass.
- [x] `git grep -n "fetch --tags origin" -- skills packages test` returns exactly one shell-code site, same as before the fix.
- [x] `skills/plot-reconcile/` quotes no fetch advice — no change needed there.
- [x] `scripts/check-shell-lines.sh pr` shows zero net growth: 12113 lines now, 12113 at merge base.
- [x] No new host call added; `PR_SOURCE` (already in scope) is the only new signal read.

## Slices

### Fix

- `bug/merge-commit-not-in-this-clone` — the scan advises a fetch only when a fetch can bring the commit, and otherwise names the reason → #2201

## Notes

- Drafted from tracker issue #2155. Nothing is written to the tracker.
