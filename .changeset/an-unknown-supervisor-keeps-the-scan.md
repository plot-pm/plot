---
'plot': patch
'@plot-pm/board': patch
---

The board leaves the scan with the fleet when the supervisor reading is unknown (the status run could not be asked or was cut short) and the fleet's bridge is younger than 180 s; only a `down` or `died` reading hands the scan to the board. `/plot-fleet --status` starts no second `lsof` for a pid whose earlier `lsof` is still running.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
