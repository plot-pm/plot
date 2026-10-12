---
'plot': minor
---

The approved spike of a Design plan dispatches. After `Spike approved:` is recorded, the slice verdict, the dispatch plan gate, `implement` and the phase gate admit the one `<!-- spike -->` branch, and every other branch of the plan still refuses. The fleet scan reports how many annotated branches each slice and the whole plan hold, and `spikeSliceOf` decides which slice holds the spike, so a plan with two annotations admits nothing and a spike slice that also names a sibling offers neither branch. `/plot-implement` starts the spike branch of such a plan and refuses every other branch by name. The plan gate refuses a sibling branch as `spike-only` and names `/plot-approve <slug>` as the next command; `plot-ask.mjs plangate` takes an optional `--branch` for the branch it is asked about.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: minor
    plot-implement: minor
-->
