---
"@plot-pm/board": patch
---

Fixed `plot-impl-status.sh` and `plot-deliver.sh` reading a cross-repo PR reference (`→ owner/repo#N`) through whichever host CLI the checkout declared, rather than the one the referenced repository actually lives on (#2158): a Bitbucket checkout naming a merged GitHub PR saw it as absent, and `plot-deliver.sh` refused the branch as unmerged. The `host` port's adapter now resolves the host: for a `--repo` reference, `Host.prState` and `Host.prMerged` ask the checkout's own backend first and, on a clean miss only, the other drivable backend once; an unreachable host still reports `unknown`, never `not merged`. `plot-host.sh` selects that other backend under `PLOT_HOST_OTHER=1`. `plot-impl-status.sh` asks the new `board/plot-pr-state.mjs` bundle for a cross-repo reference, and `deliverability.ts` reads the reference's repo from the plan text and asks `Host.prState` for it instead of `Host.prMerged`, which has no repo to ask with.

<!--
plan: docs/plans/2026-10-24-plot-deliver-and-plot-impl-status.md
bumps:
  skills:
    plot: patch
-->
