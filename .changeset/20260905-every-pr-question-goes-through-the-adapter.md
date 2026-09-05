---
"plot": minor
---

Every PR question goes through `plot-host.sh`, and a CI gate keeps it that way. `plot-reconcile-scan.sh`, `plot-agent-monitor.sh` and `plot-pr-state.sh` each called `gh` directly, so each answered about GitHub and nothing else — on a Bitbucket checkout `plot-pr-state.sh` reported `{"found": false}` about a plan whose PR was open. `pr-list` gains `--repo`, the pin its two sibling ops already take.

<!--
bumps:
  skills:
    plot: minor
-->
