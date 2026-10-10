---
'plot': minor
---

`plot-ask.mjs merge <pr> <sha>` merges a pull request through a domain workflow. It re-asks the host through `pr-state`, then runs `plot-host.sh pr-merge --match-head <sha>`, or refuses with a named reason: `unaskable`, `pr-not-open`, `head-moved`, `draft`, `checks-not-green`, `checks-unbound` or `default-branch-red`. `plot-host.sh pr-state` now reports `headSha`, `checks` and `checksSha`, and `pr-merge --match-head` pins a GitHub merge to that commit. Bitbucket refuses the pin and merges nothing.

<!--
plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md
bumps:
  skills:
    plot: minor
-->
