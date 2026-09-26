---
'@plot-pm/board': minor
'plot': patch
---

A Draft plan card offers **Interrogate** beside **Approve**. The button calls `POST /api/interrogate`, which runs the new `Interrogate command` config key with a prompt asking for `/plot-panel <plan path>`, and `GET /api/interrogate/<slug>` reports whether that panel is running, done or failed, with its log path. The route refuses when the key is absent or `none`, when the plan is past Draft, while a panel for the same plan still runs, and off localhost; each refusal names its reason, and a missing key renders the button disabled with the key named. The board writes nothing to the plan: `/plot-panel` records the verdicts, `panel.md` and the `Rounds:` increment. The rounds badge now marks a Draft plan with no `Rounds:` field as `not interrogated`, in an outlined badge distinct from a recorded `0 rounds`. `Approve` stays enabled at every round count.

<!--
plan: docs/plans/2026-09-26-a-card-sends-its-plan-to-the-jury.md
bumps:
  skills:
    plot: patch
-->
