---
'plot': patch
---

`plot-dispatch.sh --start`, `/plot-fleet --start` and fleetd's agent starts refuse when the agent runs the worker loop on the `command` runner and its resolved prompt file is absent. The refusal names the file and `plot-install-prompt.sh` and runs before any desk is cut or any claim is taken. The `sdk` runner is not refused, because it falls back to the shipped `templates/worker-prompt.md`.

<!--
plan: docs/plans/2026-11-04-a-missing-plot-worker-prompt-sh.md
bumps:
  skills:
    plot-dispatch: minor
-->
