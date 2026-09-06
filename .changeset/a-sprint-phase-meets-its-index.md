---
'plot': minor
---

`plot-reconcile-scan.sh` reports a sprint whose `Phase:` disagrees with `docs/sprints/active/`, in either direction: Active with no link, or linked while Planned or Closed. Two records of *is this sprint running*, and nothing read the pair — measured 2026-09-06, the index held one symlink over a file reading `Phase: Planned`, and days earlier a sprint read `Active` while absent from the index. It carries its own footer key `sprint_index_drift=`, distinct from `sprint_drift=` which counts plans, and it gates nothing.

<!--
plan: docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md
bumps:
  skills:
    plot: minor
-->
