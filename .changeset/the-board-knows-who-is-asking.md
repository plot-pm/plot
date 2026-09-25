---
'plot': patch
'@plot-pm/board': patch
---

The board payload names who is reading it. `plot-host.sh account` prints the signed-in GitHub login from `gh`'s `hosts.yml` — the reading `budget_account` already makes, at no request's cost — and `PLOT_BUDGET_ACCOUNT` overrides it. It exits 3 where `hosts.yml` names no user and never prints `unknown`. On Bitbucket it exits 4: `budget_account` answers the workspace there, and neither `bb` stores a username without an API request. `/api/board` carries the answer as `server.hostUser`, and git's `user.email` beside it as `server.gitEmail`, each `''` where it cannot be read. Both are read through adapters (`Host.account`, `Trees.userEmail`) and cached for 60 s. Nothing filters on them yet.

<!--
plan: docs/plans/2026-09-24-the-board-shows-me-only-my-work.md
bumps:
  skills:
    plot: patch
-->
