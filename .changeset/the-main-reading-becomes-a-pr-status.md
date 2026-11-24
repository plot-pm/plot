---
'plot': minor
---

fleetd writes a `plot/main` commit status on the head of every open pull request into the default branch. While main is settled red within `Checks wait`, the status reads `failure` with the description `main is red on <9 hex>; merge the repair PR first`; the repair PR that the repair record names and the repair exception admits reads `success` (`repair PR for <9 hex>`); every other reading, including an absent or stale one, reads `success`. A pull request into another base gets no `plot/main` status. The new domain rule `mainHoldStatus` decides the status from `defaultBranchRed`, `holdsApply` and `repairMergeVerdict`, so the status and the merge controller read one decision. fleetd writes through `Host.commitStatus` as the `Review app`, and only where the wanted status differs from the one it last wrote for that head, which it keeps in `.plot/state/main-status.json`; a failed write is retried on the next pass. A pass where no status changed reads only files and starts no process.

<!--
plan: docs/plans/2026-11-23-github-refuses-a-merge-into-a-red-main.md
bumps:
  skills:
    plot: minor
-->
