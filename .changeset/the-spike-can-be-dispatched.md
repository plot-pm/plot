---
'plot': minor
---

The approved spike of a Design plan dispatches. After `Spike approved:` is recorded, the slice verdict, the dispatch plan gate, `implement` and the phase gate admit the one `<!-- spike -->` branch, and every other branch of the plan still refuses. The plan gate refuses a sibling branch as `spike-only` and names `/plot-approve <slug>` as the next command; `plot-ask.mjs plangate` takes an optional `--branch` for the branch it is asked about.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->
