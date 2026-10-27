---
'plot': patch
---

`plot-undeliver.sh` reads a plan's branches in both slice formats and refuses `refs-swept` only for lost work: a branch with no remote ref, no host-recorded merge and a PR that closed unmerged. An origin or host that does not answer refuses `refs-unknown` and does not claim deletion. The refusal names the plan slug, the script records its state receipt, and it moves the plan's index entry from `delivered/` to `active/`. The state-gate refusal for Delivered → Approved names `/plot-reject`.

<!--
plan: docs/plans/2026-10-27-plot-undeliver-never-refuses-refs-swept.md
bumps:
  skills:
    plot: patch
-->
