---
'plot': patch
'@plot-pm/board': patch
---

`/plot-init` writes `Worker command: PLOT_UNATTENDED=1 plot-worker-loop.sh`, and `/plot-dispatch` step 3 offers the same value where the key is absent: yes writes it, no writes `none`, and no harness command is offered (#1124). `plot-dispatch.sh` puts its own directory first on `PATH` for the command it launches, so the bare name resolves to the loop shipped beside it. An absent key still means not set up: `--start` and `--restart` start nothing and name the value to set. The decision is the domain rule `startCommand`, asked through the `plot-start-command.mjs` bundle that replaces `plot-free-agent-command.mjs`, and the free-agent refusal's repair now names the bare value first.

<!--
bumps:
  skills:
    plot-dispatch: patch
    plot-init: patch
    plot: patch
-->
