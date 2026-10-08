---
'@plot-pm/board': minor
---

`POST /api/continue` reaches a desk whose loop ended `blocked` and left no manifest behind: `continueTarget` (new in `@plot-pm/domain`) reads the desk's `.plot-worker.ending.json` as a fallback when no manifest names it, and the route writes a fresh manifest for the branch the ending record names before starting the new loop, recovering the resume id from the desk's own transcript directory. A `blocked` ending for a different branch, or no usable ending at all, still refuses `no-manifest` exactly as before.

<!--
plan: docs/plans/2026-10-08-a-blocked-agent-s-question-has.md
bumps:
  skills:
    plot: patch
-->
