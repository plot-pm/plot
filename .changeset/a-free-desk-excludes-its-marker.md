---
'plot': patch
---

A free desk no longer reads as stalled in a clone that has no `.git/info/exclude` (#1130). `plot-dispatch.sh --start` and the worker loop's hop added `.metadata_never_index` to `info/exclude` only when that file already existed, so such a clone kept the marker as an untracked file and the AgentMonitor reported each waiting agent as `holds unlanded work`. Both now call `plot_desk_exclude` in `plot-worker-state.sh`, which creates `info/` and `exclude` when absent and adds the line once.

<!--
bumps:
  skills:
    plot-dispatch: patch
    plot: patch
-->
