---
'plot': patch
---

When main settles red, fleetd collects the episode's candidate commits and names the oldest red PR merge, so a red episode reverts the PR that broke main even when a second PR merged on top of it before CI settled.

<!--
plan: docs/plans/2026-11-17-main-merges-more-than-one-pr-per-ci-run.md
bumps:
  skills: {}
-->
