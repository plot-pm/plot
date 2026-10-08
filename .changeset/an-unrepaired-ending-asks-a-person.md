---
'@plot-pm/board': minor
'plot': patch
---

`endingAction` answers `needs-a-person` outright for `blocked`, `spend-limit`, `unstarted`, `run-limit` and `checks-unanswered`, unless the branch's PR merged, and the registry tick writes a `PLOT-BLOCKED.md` marker for a `needs-a-person` verdict instead of sealing a `blocked` declaration. Each ending is put to a person once: the tick records the ask in `.plot/state/ending-asks.tsv`, keyed by plan, branch and the ending file's time, so a desk whose marker a person's answer removed is not asked again about the same ending. The escalation pass reads markers on desks no manifest names, so `Notify command` fires for these markers as the question ages.

<!--
plan: docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md
bumps:
  skills:
    plot-fleet: patch
-->
