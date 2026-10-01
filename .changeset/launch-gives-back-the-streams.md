---
'plot': patch
---

A dispatch returns while its agent runs. Both launch sites end in `exec nohup sh -c` and redirect the outer subshell, so a caller reading `--start`, `--restart` or a claim through a pipe sees end-of-file when the dispatcher returns rather than when the agent exits. Measured 2026-10-01, `--start 1` took 20.39 s through `| cat` and 1.12 s after.

<!--
plan: docs/plans/2026-10-01-a-start-returns-while-its-agent-runs.md
bumps:
  skills:
    plot-dispatch: patch
-->
