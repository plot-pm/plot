---
"@plot-pm/board": patch
---

The reaper now removes the checkout of a desk whose branch a plan gave up (`deferred:` or `moved:`) when the head is fully on `origin/<branch>`, the tree is clean apart from its `PLOT-BLOCKED` marker, no worker is alive and the host reports no open PR. The marker text is saved to `refusals.tsv`, the local branch is deleted only after a fetch in the same run shows nothing unpushed, and `origin/<branch>` is never touched.

<!--
plan: docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md
bumps:
  skills: {}
-->
