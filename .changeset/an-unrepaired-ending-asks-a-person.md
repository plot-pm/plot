---
'@plot-pm/board': minor
'plot': patch
---

`endingAction` answers `needs-a-person` outright for `blocked`, `spend-limit`, `unstarted`, `run-limit` and `checks-unanswered`, and the registry tick now writes a `PLOT-BLOCKED.md` marker for any `needs-a-person` verdict instead of sealing a `blocked` declaration. `escalated` reflects marker-file presence rather than a stale declaration, so a repeat tick writes no second marker and `questionEscalation` notifies on the one marker a person actually sees.

<!--
plan: docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md
bumps:
  skills:
    plot-fleet: patch
-->
