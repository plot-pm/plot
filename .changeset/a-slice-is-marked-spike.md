---
'plot': minor
---

`plot-plan-meta.sh` reads a spike marker on a branch line (an HTML comment `spike`, or `Tracer: yes` in `## Status`) and the `Spike approved:` record, and `spikeOf` in the domain names the spike branch of a plan, or nothing when the plan marks none. The fleet scan carries the tracer reading on the pulse plan and two spike columns on each slice's verdict line; the eligibility rule does not read them yet. `plot-dispatch.sh` asks `plot-ask.mjs plangate` for the plan's phase and `Impl:` gate instead of its own `case` blocks.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->
