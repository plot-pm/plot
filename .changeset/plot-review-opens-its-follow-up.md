---
'plot': patch
'@plot-pm/board': patch
---

`plot-review` opens its follow-up issue in a repository that declares no `Tracker`. On a `github` git host it opens the issue through `githubIssueOpen`, the `plot-host.sh issue-open` request `trackerGithub` sends, labelled `ai-generated`; on another git host the issue-open answers `unaskable`. Any finding opens the issue, so HIGH 0 with MEDIUM or LOW findings writes `success` with the issue as its target. An issue that is not opened no longer skips the status: `plot-review` writes `plot/review` on the reviewed SHA, names why no issue was opened, and exits 4. `trackerGitHost` and `plot-verify` are unchanged: with no `Tracker`, a refuted claim opens no issue.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
-->
