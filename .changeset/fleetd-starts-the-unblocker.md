---
'plot': patch
---

fleetd's tick now runs the unblocker role for real: a waiting desk's PLOT-BLOCKED marker gets exactly one in-flight run across the fleet, taking the oldest marker first, and every run ends in one recorded outcome (`started`, `escalated <reason>`, `refused <reason>`, or `failed <detail>`) so a failed run never retries every tick. The unblocker role definition now requires an `ANSWER` / `ESCALATE: <reason>` first line and always escalates on scope, test, plan, or rule questions.

<!--
plan: docs/plans/2026-11-03-a-desk-s-design-question-waits.md
bumps:
  skills:
    plot: patch
-->
