---
'plot': patch
---

`plot-tmp.sh` runs `mktemp` with INT, TERM and PIPE ignored, so a signal sent to a script's process group can no longer end `mktemp` after it creates a temp path and before it prints the name. Such a path was never registered and stayed in `TMPDIR` after the script's cleanup ran; CI run 38169324238 failed on one `plot-host-prlist-err.*` this way. The script still records the signal and stops with it once the path is registered.

<!--
bumps:
  skills:
    plot: patch
-->
