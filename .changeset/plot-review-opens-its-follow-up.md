---
'plot': patch
'@plot-pm/board': patch
---

`plot-review` opens its follow-up issue in a repository that declares no `Tracker`. `trackerGitHost` on a `github` git host now opens the issue through `plot-host.sh issue-open` as `github-issues`, the request `trackerGithub` sends, labelled `ai-generated`; on another git host it answers `unaskable` and names the host. Any finding opens the issue, so HIGH 0 with MEDIUM or LOW findings writes `success` with the issue as its target. An issue that is not opened no longer skips the status: `plot-review` writes `plot/review` on the reviewed SHA, names why no issue was opened, and exits 4. `plot-verify` resolves the same tracker, so in such a repository a refuted claim now opens an issue too.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
-->
