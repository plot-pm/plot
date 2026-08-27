---
"@plot-pm/board": minor
---

The board's dispatch button now calls /plot-implement before spawning a worker

When the Start work button is clicked, /api/dispatch now:
1. Checks that `Implement command` is configured in Plot Config
2. Runs the implement command synchronously, which executes /plot-implement to create a hand-off brief
3. Only after the brief is created does it spawn plot-dispatch.sh

This ensures workers always have a brief that tells them what to build and what decisions are settled. Without an `Implement command` configured, dispatch refuses with 409 and names the missing key.

A failing /plot-implement (drift detected, no eligible branch, phase wrong) also refuses dispatch with 409 and surfaces the command's own output, so the operator sees why the work cannot start.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
