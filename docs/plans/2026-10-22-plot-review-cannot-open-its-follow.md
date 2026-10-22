# plot-review cannot open its follow-up issue past 200 open issues and loses the findings

> `plot-review` looks for an existing follow-up issue by reading at most 200 labelled open issues, refuses to open an issue when that read is truncated, and then leaves its findings only in a local file.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2336
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-review` finds the open follow-up issue of a PR without reading every labelled open issue, and a review that cannot open an issue still publishes its findings on the PR.

## Motivation

On 2026-10-22, `plot-review.mjs 2335` reviewed plan PR #2335, found 1 HIGH, and set `plot/review=failure`. It then printed `could not look for an open follow-up issue of PR #2335: the read stopped at 200 issues` and exited 4. The repository held more than 200 open issues.

Two defects combine:

1. `openIssueOfPr` in `packages/board/src/server/entry/review.ts` calls `issueListLabelled(REVIEW_ISSUE_LABEL, LOOKUP_LIMIT)` with `LOOKUP_LIMIT = 200`. When the read is incomplete and no issue for the PR is among the first 200, it answers `ok: false` ("not knowing is not the same as no issue existing"). The rule is correct, because opening on an unknown answer recreates duplicate issues. The lookup is the defect: its cost and its failure point grow with the number of open review issues, not with the one PR asked about.
2. When the follow-up fails, the findings exist only in `<git-common-dir>/plot/state/reviews/<pr>-<sha>.md`. The PR has no comment and the status has no description, so a reader of the PR sees a failed review with no reason.

## Design

### Approach

**Look up by the PR, not by the label.** The follow-up issue's title comes from `reviewIssueTitle(pr)`. The lookup asks the tracker for open issues whose title names the PR, through a search call, and keeps `findOpenReviewIssue` as the check on every candidate. A search that returns a complete answer settles the question. A tracker that cannot search keeps today's behaviour (`unaskable` → no lookup, open an issue).

**Put the findings on the PR when the issue fails.** When `openFollowUp` returns `ok: false`, the review posts the findings as a PR comment through the host connector. The comment carries the run marker the status description already uses, so the two match. A failed comment is reported and does not change the exit code. The exit code stays 4 for "no follow-up issue", because the issue is still missing.

### Open Points

- [ ] Search by title (`in:title "PR #N"`) or page past 200? Search is one call and its cost does not grow with the backlog; paging keeps the existing label filter and the `ISSUE_MAY_EXIST` guard unchanged. The first slice measures which tracker connectors (GitHub, Jira, none) support a title search.
- [ ] Does a search read as complete? GitHub's search API caps at 1000 results and can lag a just-created issue. The slice must state what a lagging index does to the duplicate guard.
- [ ] A PR comment goes through the host connector, not the tracker. Confirm `plot-host.sh` has a PR-comment operation on both backends, or name the gap.
- [ ] Does the comment repeat the full verdict text, or only the counts and the path of the local file? A full verdict can exceed the host's comment size limit.

## Slices

### Implementation

- `bug/plot-review-looks-up-its-issue-by-pr` — replace the 200-issue labelled read with a lookup keyed by the PR number, with tests for a backlog above 200 issues
- `bug/plot-review-publishes-findings-on-the-pr` — on a failed follow-up issue, comment the findings on the PR with the run marker, with tests for the comment and for its own failure

## Notes

- Source: https://github.com/plot-pm/plot/issues/2336
