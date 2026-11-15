---
'plot': minor
---

`plot-host.sh pr-conversation <number>` reads every comment and review of a PR, with the PR author's login, over REST only and every page; a failed page exits 3. On Bitbucket the rows are the PR's comments and its approvals, folded by `plot-jenkins-pr-checks.mjs conversation`. The `Host` port gains `prConversation`, the shell adapter maps the op, and the fixture answers `failed` for a PR it does not list.

<!--
plan: docs/plans/2026-11-09-a-merge-ignores-an-unanswered-human.md
bumps:
  skills:
    plot: minor
-->
