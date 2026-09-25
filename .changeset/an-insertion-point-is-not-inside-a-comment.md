---
'plot': patch
---

A transition record is written outside the template's HTML comment, where the parser reads it. `plot-approve` and `plot-dispatch` scanned `## Status` for the last list item and appended after it, so on a plan written from the shipped template the `Approved:` or `Started:` record landed between `<!-- Transition records` and `-->` — and `plot-plan-meta.sh` answered `approved_raw: ""` for a plan approved seconds earlier. Both writers now take `plot-deliver.sh`'s guard verbatim: an HTML comment ends the writable region.

<!--
plan: docs/plans/2026-09-25-a-record-is-written-where-it-can-be-read.md
bumps:
  skills:
    plot-approve: patch
    plot-dispatch: patch
-->
