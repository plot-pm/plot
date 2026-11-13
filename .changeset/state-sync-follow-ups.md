---
'plot': patch
---

The state-sync gate, the sync PR lookup and three small follow-ups. A failed read of the `State branch` key or the default branch now gives an unread gate, and review and merge refuse a PR that could be a sync PR as `sync-gate-unread`, where before the gate was off. `openSyncPr` asks the host for the open PRs whose head is the state branch, so a sync PR outside the first 100 open PRs is found, and the board's lag line names a forward-merge conflict only while both recorded tips are current. `NO_STATE_BRANCH` has one definition, `plot-fleetctl.sh --restart` names a failed reload and its exit code, and the board resolves the common git directory for the state-sync record once per process.

<!--
bumps:
  skills:
    plot: patch
-->
