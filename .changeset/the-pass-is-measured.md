---
'plot': patch
---

Measures the per-pass cost of converting the fleet's per-pass shell scripts into launchers against answering the same questions in-process, and records the result: the launcher variant adds 1750% CPU per pass at 8 concurrent agents, so per-pass scripts stay in shell and the question moves into the fleet's own long-lived process instead.

<!--
plan: docs/plans/2026-10-08-one-agent-pass-costs-what-its.md
bumps:
  skills:
    plot: patch
-->
