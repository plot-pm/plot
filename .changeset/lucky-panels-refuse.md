---
'@plot-pm/board': patch
---

`plot-panel.mjs check` refuses an unusable positions argument with exit 2 instead of reporting every juror as hedging. A `|` between positions, surrounding whitespace, an empty position, or fewer than two positions is a broken caller, and each refusal names the comma-form repair.

<!--
plan: docs/plans/2026-09-24-a-broken-caller-is-not-a-hedging-juror.md
-->
