---
"@plot-pm/board": patch
---

fix(@plot-pm/board): the WORKING control names the workers the filter hides

When a sprint filter would hide live workers (if applied to the WORKING
section), the fleet control now says so: `2 working (2 hidden by filter)`.
The section still renders all workers — a worker is a fact about the fleet,
not about a reader's focus — but the control no longer contradicts the
section's intent silently.

`the-filter-does-not-hide-a-worker`, wave Named.

<!--
bumps:
  skills:
    plot: patch
-->
