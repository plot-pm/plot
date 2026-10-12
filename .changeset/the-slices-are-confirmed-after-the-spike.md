---
'plot': patch
---

`/plot-approve` of a Design plan that records `Spike approved:` refuses `spike-unmerged` until the host reports the spike branch's PR merged, and `slices-unpushed` until the plan file in the checkout equals its copy on the default branch. Each refusal names its fix. The board card shows three spike states and offers *Confirm slices and approve* once the spike has merged. `/plot-release` step 3 pairs a merged spike's changeset with its Design plan.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: patch
    plot-approve: minor
    plot-release: minor
-->
