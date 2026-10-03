---
'@plot-pm/board': patch
---

`mayResolve`, `startRepair` and the `Repair` schema are deleted rather than switched off: the board's one automatic write — rebuilding and pushing an artifact-only merge conflict — has no caller left, since a PR must never carry a generated bundle. An `artifact-conflict` row now names the merge-base restore command as its evidence instead of a pending-repair state.
