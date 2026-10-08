---
'@plot-pm/board': patch
---

The registry tick's fresh session for a desk that ended `holding-work` after a prompt, or `turn-limit`, now starts. The continue workflow asked every start for a `PLOT-BLOCKED` marker, and neither ending writes one, so each tick logged `continue refused (no-question)`, started nothing and recorded nothing. A fresh start now takes its precondition from the desk's ending through the domain rule `endingAsksFreshStart`, which names exactly the endings `endingAction` answers `start-fresh` for, written for the same branch. `POST /api/continue` still refuses a desk with no marker.

<!--
plan: docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md
-->
