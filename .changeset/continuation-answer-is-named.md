---
'plot': patch
---

The worker loop passes `PLOT_CONTINUATION_HEADING` to the `command` runner's prompt when the prompt carries a continuation answer, and the shipped `worker-prompt.sh` template tells the agent to read the whole `PLOT-CORRECTION.md`, to treat the last entry as the newest, and to act on the entry under that heading as the answer of a person to its `PLOT-BLOCKED.md` question. A project with an installed `.plot/worker-prompt.sh` copies the changed sentence from `skills/plot/templates/worker-prompt.sh` into its own copy; `plot-install-prompt.sh` never overwrites an existing file.

<!--
bumps:
  skills:
    plot: patch
-->
