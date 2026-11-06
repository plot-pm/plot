---
'plot': patch
---

A person's merge passes a default-branch head that reads `unknown` for longer than `Checks wait`, instead of refusing `default-branch-unsettled` until another push lands. `fleetd`, a `pending` head and a red settled reading keep their refusals. `mergeAt` also reads the default-branch tip before any PR call, so a moved tip costs no `prState` and no `prReview` host call.

<!--
plan: docs/plans/2026-11-03-open-plot-review-findings-from-the.md
-->
