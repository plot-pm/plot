---
'plot': patch
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

A pull request says who opened it. `plot-host.sh pr-list` carries `author` on every projection, GitHub's `.author.login` and Bitbucket's `.author.nickname` (bb 1.9.0 returns no username; the nickname is the one handle field), and `''` where the host names none. The author reaches the board's PR record, the PR index, the domain's `Pr`, each card's PR and each row's PR. The PR index moves to version 2, so a store written before this reads once in full and a quiet PR also gains its author; the store never writes `''`. The domain's `ownership(row, reader)` answers `mine`, `theirs` or `unknown`, and `isMine` is false only for `theirs`: an empty login, an unanswered author, an email-shaped login, an agent with no desk here, and every plan card, issue and bare branch are `unknown` and stay shown. Nothing filters on it yet.

<!--
plan: docs/plans/2026-09-24-the-board-shows-me-only-my-work.md
bumps:
  skills:
    plot: patch
-->
