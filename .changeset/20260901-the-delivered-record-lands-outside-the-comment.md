---
'plot': patch
---

A delivery writes its `Delivered:` record where the parser reads it. `append_delivered_line` scanned `## Status` for the last list item and appended after it — but the plan template ends that section with a commented-out block whose `- **Started:** <date>, <who>, <branch>` lines are list items, so on every plan that had run through `/plot-implement` the record landed inside the comment. The failure had no symptom: the phase flipped, the push succeeded, and the summary said `record=written`, while `plot-plan-meta.sh` reported `delivered_raw: ""` for a plan delivered a minute earlier. Worse, the script's already-done test is *the record is non-empty*, so a record it could not read back was a record it wrote again — measured on `a-browser-test-serves-its-own-state`, which took two `Delivered:` lines into the comment and none into the plan. The scan now stops at an HTML comment, because a comment is where a plan keeps the shape of a record rather than a record. `test/reconcile/deliver-record-outside-comments.test.mjs` covers it in four cases, two of which fail against the old code.

<!--
bumps:
  skills:
    plot-deliver: patch
-->
