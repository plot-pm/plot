---
'plot': patch
---

The role command passes `--agents` the agents file's JSON text through `"$(cat -- '<file>')"`, so the fixer and main-repair roles start under Claude Code 2.1.231, which reads `--agents` as JSON only and refused the file path.

<!--
plan: docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md
bumps:
  skills:
    plot: patch
-->
