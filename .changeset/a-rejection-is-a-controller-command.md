---
'plot': minor
---

Reversing a delivery runs through a controller rather than by editing the phase line. `undeliver` decides the move, refuses a released plan, one that was never delivered, one with no reason, and one whose branches' refs are already swept — and `plot-undeliver.sh` performs only the write it decided, leaving the file untouched on every refusal.

<!--
plan: docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md
bumps:
  skills:
    plot: minor
-->
