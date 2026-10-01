---
'plot': patch
'@plot-pm/board': patch
---

`plot-dispatch.sh --start` refuses a `Worker command` that does not run `plot-worker-loop.sh`, before it cuts a desk (#1124). A free agent starts with an empty `PLOT_BRANCH`, and only the loop waits for a slice; a plain `claude -p` ran at once and exited while `--start` reported success. The decision is the domain rule `freeAgentCommandRefusal`, asked through the new `plot-free-agent-command.mjs` bundle. The refusal exits 1, prints `worker=no-loop` in the summary, and names the repair: the loop as the `Worker command` and the harness call in `.plot/worker-prompt.sh`. The supervisor reads `worker=no-loop` as `unaskable` and logs the repair instead of a generic start failure. The `plot-dispatch` configuration example now shows the loop. `--stop <branch>` now signals the worker's whole process group, so the loop, `claude` and its children stop with the wrapper (#1084).

<!--
bumps:
  skills:
    plot-dispatch: patch
    plot: patch
-->
