---
'plot': patch
---

`/plot-approve` of a Design plan with a `<!-- spike -->` branch refuses `spike-unmerged` until the host reports the spike branch's PR merged, and `slices-unpushed` until the plan file in the checkout matches its copy on the default branch. Each refusal names its fix: a checkout that is only behind is told to pull. Removing the annotation lifts both refusals. The board card shows three spike states, keeps Interrogate, and offers *Confirm slices and approve* once the spike has merged. The approved spike branch places as dispatchable work, and the other branches of the plan wait on its approval. `/plot-release` step 3 pairs a merged spike's changeset with its Design plan.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: patch
    plot-approve: minor
    plot-release: minor
-->
