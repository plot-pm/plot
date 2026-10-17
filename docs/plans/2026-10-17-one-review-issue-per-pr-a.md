# Tooling: one review issue per PR, a sprint goal the board reads, and a pid read that waits

> Three tooling defects: `plot-review` opens one follow-up issue per head of the same PR, the sprint template writes a goal line the board does not read, and one e2e test reads the pid file before the pid is written.

## Status

- **State:** Draft
- **Type:** bug
- **Story:** <!-- optional, story slug (docs/stories/<slug>/) — the durable intent this plan serves -->
- **Sprint:** <!-- optional, filled when plan is added to a sprint — a time-boxed selection of planned work -->
- **Issue:** #1952, #1881, #1883, #1909
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-review` updates the open follow-up issue of a PR instead of opening a second one for a new head.
- A sprint written from `templates/sprint.md` serves a non-empty goal on the board.

## Motivation

Issue #1952 groups three defects, each measured on 2026-10-16.

- **#1881:** release PR #1763 regenerates on every push to main. 7 reviews of 7 heads opened #1869, #1871, #1873, #1874, #1877, #1878 and #1880, all with the same single LOW finding. Six were closed by hand as duplicates of #1869.
- **#1883:** `skills/plot/templates/sprint.md` writes the goal as plain text under `## Sprint Goal`. The board reads the first bold line (`packages/board/src/server/board.ts:1438-1441`), so a sprint written from the template serves `goal: ""`. `2026-W42-bitbucket-jira-and-jenkins-work-with-the-board` showed this until `4396b16af` added a bold line by hand.
- **#1909:** `test/e2e/monitors-end.test.mjs` ("an agent killed at the bound is reported gone by the wrapper, not clear", ~line 404) failed on PR #1892 (run 38950234603). `waitForFile(run.pidFile)` returns when the file exists, the read then yields `''`, `Number('')` is `0`, and `alive(0)` polls `ps` on pid 0 until the wait ends.

## Design

### Approach

**#1881 — one issue per PR.** Before `plot-review` opens an issue (`packages/board/src/server/entry/review.ts`), it looks for an open issue with the `ai-generated` label and the title prefix `plot-review:` ending in `on PR #N`, through the tracker `reviewTracker` resolves. If one exists, the review comments on it with the new head SHA and any finding not yet reported, and records that issue as the review's issue. The domain decides whether an issue matches; the adapter only lists. The existing per-SHA record stays, so a re-review of the same head still reuses its recorded issue.

**#1883 — sprint goal.** The parser change is preferred over the template change: the parser also reads the first non-empty line of `## Sprint Goal` when no bold line exists, so existing sprints written from the template start serving a goal with no edit. The template stays as it is. A test parses a sprint written from the shipped template and asserts a non-empty goal.

**#1909 — pid read.** One helper in the test file waits until the pid file holds a positive integer and returns that integer. Every test in the file that reads `run.pidFile` (lines ~371 and ~411) calls it. If the wrapper writes the file with a plain redirect, it writes a temp file and renames it, so a reader never sees an empty file.

### Open Points

- [ ] #1881: update the issue body or add a comment? A comment keeps the history of heads; an edit keeps one current list.
- [ ] #1881: how does the match treat a closed issue — open a new one, or reopen? The issue text asks only about open issues.
- [ ] #1881: a Bitbucket or Jira tracker may not list by title — does the tracker port gain a find operation, and what does `trackerNone` answer?
- [ ] #1883: parser fallback or template change — the issue allows either; this plan picks the parser.
- [ ] #1909: does `plot-worker-loop.sh` write the pid file with a plain redirect today?

## Slices

- `bug/plot-review-one-issue-per-pr` — #1881: find and update the open follow-up issue of the PR <!-- builds: findOpenReviewIssue, a lookup of the open follow-up issue for a PR -->
- `bug/sprint-goal-reads-template` — #1883: parser fallback for the goal line, test from the shipped template
- `bug/monitors-end-waits-for-pid` — #1909: one helper that waits for a positive pid, used by every pid-file read in the test

## Notes

- Created from tracker issue #1952 by an unattended `/plot-idea` run. `Design` was not stated in the prompt, so the plan starts in Draft. `Review: pr` follows `Plan PRs: required`.
- The tracker received no comment, label or state change.
