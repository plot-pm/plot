---
'plot': patch
---

Every line of the budget record (`budget.tsv`) names the process that spent the call and the host operation it served, so calls per caller and operation can be counted. A line is now `b2` with 12 fields: the 10 `b1` fields, then `caller` and `op`. The caller is `$PLOT_CALLER`, which fleetd (`fleetd`), the board (`board`), `plot-pr-reader.mjs` (`reader.<pid>`) and the worker loop (`worker`) set at their entries; without it, a shell line names the script that started `plot-host.sh` and an in-process line names the running script. The shell op is the `plot-host.sh` operation, and the in-process op is the request label without its numbers. Every reader accepts both `b1` and `b2` lines.

<!--
bumps:
  skills:
    plot: patch
-->
