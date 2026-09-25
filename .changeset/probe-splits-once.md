---
'plot': patch
---

`/plot-board-setup` reports a healthy Jenkins as healthy. `plot-board-probe.sh:316` called `jen -I "$jen_instance"` with the full `<slug>/<job/path>` value where `jen` expects the slug alone, so an instance that authenticates correctly was reported `auth: failed` and adoption told the operator their credentials were wrong.

<!--
plan: docs/plans/2026-09-24-the-probe-asks-jenkins-by-its-slug.md
bumps:
  skills:
    plot-board-setup: patch
-->
