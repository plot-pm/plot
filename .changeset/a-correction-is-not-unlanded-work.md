---
'plot': patch
---

The reaper no longer keeps a desk whose only uncommitted file is a root `PLOT-CORRECTION.md`, the file the worker loop writes for the agent. Measured 2026-09-27, a desk whose pull request had merged was kept for that file alone, so an operator who helped an agent made its desk unreapable. The match is the whole porcelain line, so `docs/PLOT-CORRECTION.md` and any other path still refuse, and a `PLOT-BLOCKED*` marker still refuses. The reap decision, the "dirty trees nobody owns" sweep and `plot-reconcile-scan.sh` section 21 now read one tree through one helper, `plot-desk-dirt.sh`. `packages/board/.omc/state/last-tool-error.json` is no longer tracked, so the existing `.omc/` ignore rule covers it and no desk reports it as modified.

<!--
plan: docs/plans/2026-09-27-a-correction-is-not-unlanded-work.md
bumps:
  skills:
    plot: patch
-->
