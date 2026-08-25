---
"@plot-pm/board": patch
---

board: the WORKING count is the rows

The `working` count displayed in the WORKING section header now derives from
the same set the section renders — `agents.length`, one derivation read twice.
Previously it used `liveAgentCount`, which counted only `running` and `waiting`
entries whose branches had not landed, causing the count to disagree with the
visible rows.

Measured 2026-08-24: the registry held 23 entries, WORKING rendered 23 rows,
and the stepper reported "2 working" — the cap's balance rather than the
section's contents. A reader counting rows saw one number; the label beside
the stepper said another.

Also labels the `parallelAgents` stepper as a cap: "parallel agents (cap)"
rather than "parallel agents". A cap and a measurement are different claims;
the label now distinguishes them.

<!--
bumps:
  skills:
    plot: patch
-->
