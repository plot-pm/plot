---
'plot': patch
---

Approve and deliver run with no board through plot-approve-command.mjs and plot-deliver-command.mjs: neither needs a receipt, both refuse PLOT_UNATTENDED=1, and POST /api/deliver runs plot-deliver.mjs where no Idea command exists.

<!--
bumps:
  skills:
    plot: patch
    plot-approve: patch
    plot-deliver: patch
-->
