---
"@plot-pm/board": patch
---

An open PR whose branch no plan names now appears in the Agents tab.

The pulse walks the branches a plan lists under `## Branches` — that is what makes it a fleet view rather than a branch listing, keeping `main`, release branches and stale worktree refs out. But a fix branch opened outside a plan carries the one thing the tab exists to surface, and could not show it: two PRs sat waiting to be merged while `WAITING ON YOU` read *none*, and the pulse reported 8 branches where origin had 20.

Open PRs only. A merged PR with no plan is finished work, and admitting it would fill `done` with housekeeping nobody reads. No new host call either — the board already fetches every PR on its own slow timer, keyed by head branch.

This also fills `WAITING ON A MACHINE`, which had never once been populated since the tab shipped. Its only entry is an open PR whose checks are running, and the branches carrying PR state were exactly the ones missing from the row set.

<!--
bumps:
  skills: {}
-->
