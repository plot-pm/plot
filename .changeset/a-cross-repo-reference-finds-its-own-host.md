---
"@plot-pm/board": patch
---

Fixed `plot-impl-status.sh` and `plot-deliver.sh` reading a cross-repo PR reference (`→ owner/repo#N`) through whichever host CLI the checkout declared, rather than the one the referenced repository actually lives on (#2158): a Bitbucket checkout naming a merged GitHub PR saw it as absent, and `plot-deliver.sh` refused the branch as unmerged. `plot-host.sh` now probes the checkout's own backend first for a `--repo`-qualified `pr-state`/`pr-merged` call, and on a clean miss retries once against the other drivable backend; an unreachable host still reports `unknown`, never `not merged`. `plot-plan-meta.sh` now carries the reference's repo in a new `pr_ref` field so `deliverability.ts` can ask `Host.prState` for it instead of `Host.prMerged`, which has no repo to ask with.

<!--
plan: docs/plans/2026-10-24-plot-deliver-and-plot-impl-status.md
bumps:
  skills:
    plot: patch
-->
