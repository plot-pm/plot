---
"@plot-pm/board": patch
---

Fixed a tick landing right after `--start` reading a just-launched agent as `agents=0` and starting more agents than requested (#2409): `--start 3` followed by an immediate tick could bring the fleet to five. `scaleUp` now counts a launch whose manifest is registered but whose wrapper has not yet recorded a live pid, bounded by `Worker bound` or the recorded pid's own liveness, so a launch is counted once whether read through the registry or through its own recent start.

<!--
bumps:
  skills:
    plot: patch
-->
