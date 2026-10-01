---
'plot': patch
'@plot-pm/board': patch
---

`plot-dispatch.sh --start` refuses a `Worker command` that does not run `plot-worker-loop.sh`, before it cuts a desk (#1124). A free agent starts with an empty `PLOT_BRANCH`, and only the loop waits for a slice; a plain `claude -p` ran at once and exited while `--start` reported success. The refusal exits 1, prints `worker=no-loop` in the summary, and names the repair: the loop as the `Worker command` and the harness call in `.plot/worker-prompt.sh`. The supervisor reads `worker=no-loop` as `unaskable` and logs the repair instead of a generic start failure. The `plot-dispatch` configuration example now shows the loop.

<!--
bumps:
  skills:
    plot-dispatch: patch
    plot: patch
-->
