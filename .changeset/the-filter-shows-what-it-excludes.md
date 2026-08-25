---
'@plot-pm/board': minor
---

Show estate totals when filter is OFF, sprint numbers when ON

The sprint filter control now shows which plans are excluded when you turn it
on — estate totals while OFF, sprint numbers while ON:

- **Off:** `Total — 112 plans · 9 open · 2 WIP · 101 done`
- **On:** `Sprint — 21 members · 4 open · 0 WIP · 17 done`

**What changed:**
- New `estateTotals` field in the Fleet payload, computed server-side
- The same three-bucket derivation (open/wip/done) for both estate and sprint
- The SprintFilter component toggles between the two scopes
- When estateTotals is absent (older server), falls back to always showing
  sprint counts

**Why:**
- A reader can see the effect of the toggle before touching it
- The jump from "112 plans" to "21 members" makes the filter's scope visible
- Estate and sprint use the same derivation, so they cannot disagree about
  what a bucket means

<!--
bumps:
  skills:
    plot: patch
-->
