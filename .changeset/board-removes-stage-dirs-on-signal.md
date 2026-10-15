---
'@plot-pm/board': patch
---

The board server removes a build's `plot-board-plans-` and `plot-board-status-` stage directories when it exits or receives SIGTERM, SIGINT or SIGHUP during the build; before, a signal left them in the temp directory.

<!--
bumps:
  skills: {}
-->
