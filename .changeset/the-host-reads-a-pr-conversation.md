---
'plot': minor
---

The `Host` port gains `prConversation(pr)`, which reads every comment, inline comment and review of a PR, with the PR author's login, over REST only and every page; a failed page is a failed read, never a short list. The in-process GitHub client reads `pulls/<n>` and the three comment endpoints at 100 rows a page, and the in-process Bitbucket client reads `/comments` through its `next` links and folds them with the approvals in the domain. The shell transport answers `unaskable`, and `plot-host.sh` gains no op.

<!--
plan: docs/plans/2026-11-09-a-merge-ignores-an-unanswered-human.md
bumps:
  skills:
    plot: minor
-->
