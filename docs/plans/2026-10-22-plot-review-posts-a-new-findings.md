# plot-review posts a new findings comment on every run

> When the follow-up issue cannot be opened, `plot-review` comments its findings on the PR, and every run whose issue file reads `pending` posts a new comment instead of finding the earlier one.

## Status

- **State:** Approved
- **Sprint:** bugfix-2-28-1
- **Type:** bug
- **Issue:** #2347
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2350 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/plot-review-edits-its-findings-comment`

## Changelog

- `plot-review` keeps one findings comment per PR: a repeated review of the same PR edits the earlier comment, found by its run marker, instead of posting an identical one.

<!-- Board impact: none. The change is in the review entry point and the host connector; no plan format, template, helper-script contract or docs/plans layout changes. -->

## Motivation

PR #2343 makes `plot-review` comment its findings on the PR when the follow-up issue cannot be opened (slice `bug/plot-review-publishes-findings-on-the-pr` of `plot-review-cannot-open-its-follow`). Every run whose issue file reads `pending` posts a new comment. Repeated reviews of one PR stack identical comments, and the reader of the PR sees the same verdict several times with no sign which run is current.

The tracker side already solves this for issues: `plot-host.sh issue-comment <number> <marker> <body>` edits the comment holding `<marker>` and posts only when none exists (GitHub arm, `skills/plot/scripts/plot-host.sh`). The PR side has no equivalent operation.

## Design

### Approach

**Key the PR comment by the run marker.** The comment already carries the run marker that the status description uses. A second run reads the PR's comments, finds the one holding that marker, and edits it. When none holds it, the run posts a new one. The result is at most one findings comment per PR and marker.

**Add one marker-keyed PR comment operation to the host connector, on both backends.** The operation reads the PR's comments, matches the marker, and edits or posts. GitHub implements it with the issue-comments endpoints of the PR (the same shape as `issue-comment`); Bitbucket implements it with `pullrequests/<id>/comments`. The port stays a question about the host: the review controller calls the domain, the domain calls the port, and only the adapter reaches `plot-host.sh`.

### Open Points

- [ ] Which marker keys the comment? The run marker names one reviewed head, so a push to the PR produces a second comment, and the first one goes stale. A marker per PR (not per head) keeps one comment for the PR's whole life, and loses the history of earlier heads. This plan decides which one the reader wants.
- [ ] Does the operation extend `issue-comment` to accept a PR number on GitHub (a PR is an issue there), or is it a new `pr-comment` op? Bitbucket has no such identity, so the second answer is likely, and it keeps the two backends' operation names equal.
- [ ] Bitbucket comment edits need the comment id and a version; confirm the `bb api` call can PUT a comment, or name the gap.
- [ ] A failed edit: fall back to a new comment, or report and change nothing? A fallback re-creates the stacking this plan removes.
- [ ] `#2343` must be merged first: the posting code this plan changes lives in that slice.

## Slices

### PR comment by marker

- `bug/plot-review-edits-its-findings-comment` — add a marker-keyed PR comment operation (read, edit, else post) to `plot-host.sh` and the host port on GitHub and Bitbucket, and use it for the findings comment, with tests for a second run on the same PR editing the first comment and for a run with no earlier comment posting one <!-- builds: pr-comment, a marker-keyed PR comment edit-or-post on the host connector --> → #2356

## Notes

- Source: https://github.com/plot-pm/plot/issues/2347
- Left open by the review of #2343, 2026-10-22.
