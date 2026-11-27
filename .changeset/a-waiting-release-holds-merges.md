---
'plot': patch
---

fleetd's merge arm holds PRs into the default branch as `release-waiting` while the release PR's head reads green CI and a `pending` or `success` review, for at most `Checks wait` per head, so a release head is no longer replaced before its review ends. `.plot/state/release-hold.json` records when the hold for a head began.

<!--
plan: docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md
bumps:
  skills:
    plot: patch
-->
