---
'plot': minor
---

`plot-plan-meta.sh` reads two markers and one record. `<!-- spike -->` on a branch line marks that branch as the plan's spike, and `Tracer: yes` in `## Status` marks the whole plan as a tracer bullet; the `Spike approved:` record is read as written. `spikeOf` in the domain names the one spike branch of a plan, or nothing when the plan marks none or more than one. The fleet scan carries the tracer reading on the pulse plan and two `1`/`0` spike columns on each slice's verdict line; the eligibility rule does not read them yet. `plot-dispatch.sh` asks `plot-ask.mjs plangate` for the plan's phase and `Impl:` gate instead of its own `case` blocks.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: minor
-->
