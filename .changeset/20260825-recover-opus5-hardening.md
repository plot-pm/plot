---
"@plot-pm/board": patch
---

plot: recover what PR #57 still had that main did not

Six branches opened 2026-07-25 had their PRs closed the same day, each noting
"Consolidated into #57". #57 then sat open four weeks and fell 1738 commits
behind main, with six conflicts — all in prose files where meaning matters.

A rebase was rejected. The July contributions are 1–11 lines per file against
45–218 lines of subsequent work on main, so rebasing would risk four weeks of
development to land additions that conflict with nothing.

Measured per file instead, by grepping main for each change's own subject: four
of the six changes had already reached main by other routes. Four things had
not, and they are here — Principle 13 (renumbered from 10, since main gained two
principles while #57 waited), the model-provenance doc, the ralph-plot-sprint
deliverable rubric, and the runner's scratch directory in the ignore file.

The runner script's 156 lines of budget machinery are deliberately NOT here: it
is code, not prose, and its interaction with four weeks of runner changes was
never measured. The plan says so, and says the tracer question stays open.
