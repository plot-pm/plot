# Bitbucket and GitHub listings read one page and report it as complete

> Four listing paths in `plot-host.sh` and `plot-pr-merged.sh` read one page and either drop the rest silently or guard against a case that cannot occur, so a branch with many PRs reads as complete when it is not.

## Status

- **State:** Approved
- **Type:** bug
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2522 merged
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2484
- **Review:** pr
- **Impl:** own branches
- **Started:** 2026-10-24, jwloka, `bug/bitbucket-listings-follow-next`

## Changelog

- On Bitbucket, `pr-merged-heads` and the `pr-review` arm follow every page, or report a possibly truncated answer. On GitHub, the open-PR lookup in `plot-pr-merged.sh` asks per branch, so `plot-release-refs.sh` no longer deletes a ref that has a live PR.

<!-- Board impact: none. No plan format, template, layout or board payload change. -->

## Motivation

Issue #2484 collects follow-up findings from plot-review (#2051, #2194, #2210, #2211, #2228, #2405), checked against `origin/main` at `84b1638e4` on 2026-10-24. They share one defect: a listing reads a single page and the code treats that page as the whole answer.

- `bb_branch_query` (`plot-host.sh:1071`) asks `pagelen=50` and never follows `next`. Its full-page guard tests a case that cannot occur, because the query already filters on `MERGED`. A branch with more than 50 PRs truncates `pr-merged-heads` and exits 0 (`:3944`, `:4056`).
- The Bitbucket `pr-review` arm (`:4069`) reads one page of comments (`pagelen=100`) and statuses (`pagelen=50`), so a later review-bypass comment is missed.
- On GitHub, `_plot_open_lookup` (`plot-pr-merged.sh:141`) lists repo-wide open PRs capped at 100. A truncated page reads `unaskable`, and `plot-release-refs.sh` deletes a ref that has a live PR.
- The `pr-state` usage header (`:53`) promises exit 3 on a full page without a match, which the arm does not do.
- `plot-pr-merged.sh` writes stderr to a predictable `/tmp` path (`:141`), and its header (`:58`) describes `gh` calls the file no longer makes.
- The Bitbucket stubs in `test/reconcile/host.test.mjs` (`:8621`, `:8649`) emit invalid bash without `mergedBranch`, never pass `openRows`, and encode branch names with `encodeURIComponent`, which differs from `url_encode` on `!'()*`.
- The Approved plan `plot-host-bitbucket-pr-list-reads` drops the window's size-based completeness check and the measured `pagelen=50` request saving of `bb api` without saying so (`:37`, `:62`), says `bb_require_json` gates on a version (`:39`), and lists `bb_branch_query` and `bb_window_listing` under the one-page assumption (`:43`).

## Design

### Approach

1. `bb_branch_query`, `pr-merged-heads` and the Bitbucket `pr-review` arm follow `next` until the answer is complete, bounded by the existing page cap, and report `possibly truncated` on stderr when the cap stops them.
2. Each full-page guard tests a case the query can produce. The `pr-state` usage header documents only exits the arm produces.
3. `_plot_open_lookup` asks per branch on GitHub, as the Bitbucket arm does, so a repository with more than 100 open PRs cannot make the answer `unaskable` for a branch that has one. It writes stderr to a `mktemp` file, and the header describes the calls the file makes.
4. The Bitbucket stubs produce valid bash for every option and encode branch names as `url_encode` does. A test covers the Bitbucket open lookup returning `found`.
5. The Approved plan `plot-host-bitbucket-pr-list-reads` is amended: it keeps the window's completeness check and the `pagelen=50` saving, or states why it drops them, and its three inaccurate statements are corrected. That plan is Approved and Started, so the amendment goes through its own branch and review, not a silent edit here.

The layering rule holds: every change stays in `plot-host.sh`, `plot-pr-merged.sh` and the host adapter. `plot-host.sh` stays the one place that talks to the host CLI.

### Open Questions

- [ ] Does `pr-merged-heads` follow pages or only report truncation? Following costs requests on a cold scan; reporting is cheap and matches the `unaskable` contract.
- [ ] Per-branch GitHub open lookup raises the call count for `plot-release-refs.sh`. Measure the count on this repository before choosing between per-branch and a paged repo-wide list.
- [ ] The amendment to the Approved plan touches a plan whose slice is Started. Confirm that the amendment is a separate change and that the slice's PR is not blocked on it.
- [ ] Do the findings that cite plan lines (`:37`, `:39`, `:43`, `:62`) still hold at the current `origin/main`? Re-check each before editing.

## Slices

### Bitbucket paging

- `bug/bitbucket-listings-follow-next` — `bb_branch_query`, `pr-merged-heads` and the `pr-review` arm follow `next` or report truncation; the dead full-page guards and the `pr-state` usage header are corrected. <!-- builds: bb_branch_query paging -->

### GitHub open lookup

- `bug/github-open-lookup-asks-per-branch` — `_plot_open_lookup` asks per branch, writes stderr to `mktemp`, and the file header describes its calls. <!-- builds: _plot_open_lookup per-branch ask -->

### Stubs and plan

- `bug/bitbucket-stubs-and-listing-plan` — `makeBbOnlyStub` emits valid bash and encodes like `url_encode`, a test covers the Bitbucket open lookup, and the Approved plan is amended. <!-- builds: makeBbOnlyStub open-rows coverage -->

## Notes

- Source: https://github.com/plot-pm/plot/issues/2484. The tracker received no write from this plan.
- Related: `docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md`, `docs/plans/2026-09-15-a-complete-page-is-not-truncated.md`, `docs/plans/2026-09-20-a-pr-list-reads-every-page.md`.
