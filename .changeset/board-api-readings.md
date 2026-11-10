---
'@plot-pm/board': patch
---

fleetd's snapshot carries what the board's plan cards read: each plan's issues, design and verification records, challenge rounds and parse error, the default tip, the plan authors, the verification inputs of Delivered plans with their delivery commit, the parsed plans on prefixed branches, and the parsed sprints and stories. `SNAPSHOT_PROTOCOL` is 3, so a board and a fleetd of different builds fall back to the board's own reads until both run the same build. The board's branch-plan set and its sprint and story parsers are the domain rules fleetd calls.

<!--
plan: docs/plans/2026-11-09-board-api-starts-nothing.md
-->
