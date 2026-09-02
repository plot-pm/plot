---
'plot': minor
'@plot-pm/domain': minor
---

Five gates that judge a finished agent by what it left behind: a merged PR, a valid changeset, a clean tree, no `PLOT-BLOCKED` marker, and an annotated plan line. Each is a pure function returning `null` or a failure written to be pasted verbatim into the next attempt's correction prompt. An unreachable host fails the PR gate and says so — silence is never permission.

<!--
bumps:
  skills:
    plot: patch
-->
