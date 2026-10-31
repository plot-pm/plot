---
'plot': patch
---

plot-fleet-scan.sh reads each plan's mode, adding commit and file name from one lookup table and parameter expansion instead of starting `basename`, `readlink` and `awk` per plan; its output is unchanged.

<!--
plan: docs/plans/2026-10-31-the-fleet-scan-re-reads-what.md
bumps:
  skills:
    plot: patch
-->
