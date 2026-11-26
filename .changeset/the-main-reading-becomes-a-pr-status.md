---
'plot': minor
---

fleetd writes a `plot/main` commit status on the head of every open pull request into the default branch. While main is settled red within `Checks wait`, the status reads `failure` with the description `main is red on <9 hex>; merge the repair PR first`; the repair PR that the repair record names and the repair exception admits reads `success` (`repair PR for <9 hex>`); every other reading, including an absent or stale one, reads `success`. A pull request into another base gets no `plot/main` status. The new domain rule `mainHoldStatus` decides the status from `defaultBranchRed`, `holdsApply` and `repairMergeVerdict`, so the status and the merge controller read one decision. fleetd writes through `Host.commitStatus` as the `Review app`, and only where the wanted status differs from the one it last wrote for that head, which it keeps in `.plot/state/main-status.json`; a failed write leaves the head unmarked and is written again an hour later, or on the next pass where the head or the wanted status changed. A pass where no status changed reads only files and starts no process. Pull requests that share a head and a wanted status cost one write per pass. A PR's `checks` and `failing_checks` leave out `plot/main`, as `ciChecks` does, so a red main makes no open PR read `failing` and the admitted repair PR still merges.

<!--
plan: docs/plans/2026-11-23-github-refuses-a-merge-into-a-red-main.md
bumps:
  skills:
    plot: minor
-->
