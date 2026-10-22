---
'plot': patch
---

`plot-review`'s follow-up lookup now searches the tracker by the PR's own title text (`issueListWithTitle`) instead of reading the whole `ai-generated`-labelled backlog: a backlog past 200 open issues with the match beyond row 200 made the old read `complete: false` and refuse with no match found, when an open follow-up issue existed. The title search still runs `findOpenReviewIssue`'s exact check over every candidate, so a search for `PR #1` cannot be satisfied by an issue titled `... on PR #12`. A tracker that cannot search by title (Jira, none) answers `unaskable`, unchanged from before: the caller opens a new issue, as it always has.

<!--
plan: docs/plans/2026-10-22-plot-review-cannot-open-its-follow.md
bumps:
  skills:
    plot: patch
-->
