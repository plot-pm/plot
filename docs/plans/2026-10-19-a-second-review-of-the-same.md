# A second review of the same head writes its verdict

> A second `plot-review` run on a head that already has a recorded issue sets `plot/review` and writes no verdict, so the status and the written findings disagree.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2115
- **Story:** <!-- optional, story slug (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-review` writes the full verdict of every run to the PR's review issue, also when the head already has a recorded issue, and the `plot/review` status description names the run it belongs to.

<!-- Board impact: none expected. The change is in `packages/board/src/server/entry/review.ts` and the bundle `plot-review.mjs` built from it; the plan format, the template and the `docs/plans` layout are untouched. -->

## Motivation

PR #2104, head `7fe19d70f25aa2bd0f87cd59f13a9c394e079795`, was reviewed twice on 2026-10-19:

| time (UTC) | `plot/review` status | findings in #2113 |
|---|---|---|
| 16:32:17 | success, "no HIGH findings" | issue body: `HIGH 0, MEDIUM 2, LOW 4` |
| 16:44:37 | failure, "1 HIGH finding" | none |

After the second run, #2113 held 0 comments. The failure status blocks the merge, and no artefact names the HIGH it reports. The second run printed `failure, 1 HIGH, issue https://github.com/plot-pm/plot/issues/2113`, a link to an issue that does not hold that verdict.

Cause, read from `openFollowUp` in `packages/board/src/server/entry/review.ts`: the issue file for a PR and head holds the issue id after the first run. A second run reads that id (`recorded`), skips both the `issueComment` and the `issueOpen` branch, and returns the issue URL. Only a head with no recorded id gets a comment. Since #1962 (one issue per PR) each head's verdict is a comment, so the recorded-id path is the one that drops it.

## Design

### Approach

Treat the recorded id as the place to write, not as proof that the verdict is written.

1. In `openFollowUp`, when `recorded` holds an issue id, call `deps.tracker.issueComment(recorded, followUp.body)` before returning the URL. A refused comment returns `{ ok: false, why }`, the same shape the existing-issue branch returns, so `review.ts` still writes the status and exits `EXIT.issueNotOpened` with the reason.
2. Name the run. The status description carries a run marker, and the comment carries the same marker, so a reader matches a status to its comment. The marker is the verdict timestamp (UTC, to the second) or a short run counter; the choice is an open question.
3. Keep `pending` semantics unchanged: a recorded `pending` still opens and comments nothing.

The contract in the TSDoc of `review.ts` (line 62: "a second run against the same head reuses the recorded issue and opens none") stays true for opening and changes for writing: a second run opens no second issue and does write its verdict.

A repeated run on one head with an unchanged verdict then adds a second comment with the same counts. That is the cost of "every review writes its verdict", and the issue states it as the expectation.

### Open Questions

- [ ] Run marker: verdict timestamp in the status description and the comment, or a per-head run counter kept beside the issue file? The timestamp needs no new state; the counter reads better ("run 2").
- [ ] Status description length: the host caps a commit-status description (GitHub: 140 characters). Does `1 HIGH finding; follow-up issue not opened; run 2026-10-19T16:44:37Z` fit with the existing suffix?
- [ ] A second run whose verdict equals the recorded one: comment anyway, or skip and say so in the output? The issue asks for the first; the second saves noise.

## Slices

### Verdict per run

- `bug/plot-review-writes-every-verdict` — `openFollowUp` comments the verdict on the recorded issue, the status description and the comment carry the run marker, and a test pins both: a second run on one head adds a comment, and the status and the last comment agree. <!-- builds: a verdict comment for a head with a recorded issue -->

## Notes

- Related: `docs/plans/2026-10-17-one-review-issue-per-pr-a.md` (delivered; introduced the per-PR issue and the per-head comment).
- Issue: https://github.com/plot-pm/plot/issues/2115
