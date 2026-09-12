---
'plot': minor
---

A failing build is handed back to the agent that pushed it. The BuildMonitor's `build failed` finding had no consumer on the estate — CI's verdict was measured, published, and dropped — and the only correction path was a person reading a marker. The worker loop now reads the finding on the pass after the prompt returns, writes the failure text verbatim into `PLOT-CORRECTION.md` in the desk, and resumes the agent's own session, bounded by a new `Correction budget` config key defaulting to two. A spent budget writes the `PLOT-BLOCKED` marker naming the attempt count, so the human gate is reached later rather than first.

<!--
plan: docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md
bumps:
  skills:
    plot: minor
-->
