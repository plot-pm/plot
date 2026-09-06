---
'plot': minor
---

`plot-reconcile-scan.sh` reports a sprint that is **not Closed** whose declared
`Release:` has been tagged. The train has left; the sprint file has not caught
up, and nothing said so.

Measured: `2026-W36-a-half-landed-workflow-says-so` targets 2.13.0, which
shipped as `v2.13.0`. The file reads `Phase: Planning`, has not moved since
2026-08-29, and none of its eight items ever became a plan. That is a sprint the
estate should be able to say something about without a person opening the file.

**It reports and never closes.** Closing is the team's word — the rule section
14 states about a sprint's phase. A shipped release is evidence the sprint's
window passed, not evidence its work is done: the measured sprint's eight items
are all still open, so a section offering `/plot-sprint close` would be
suggesting the team abandon them.

The facts are not re-derived. `plot-sprint-release.sh` already reads a sprint's
release and its items and decides nothing; this calls it once per sprint file
and applies one comparison. A second reader of the same line would drift from it
the first time one of them was taught something the other was not.

Two things a first reading gets wrong, both measured. The sprint reads `Phase:
Planning` where the template says `Planned`, so the population is *not Closed*
rather than a list of open phases. And a `Release:` may carry prose after the
version — one sprint here reads `2.13.0 — **released 2026-09-05**, ...` — so the
first `N.N.N` in the field is the target. A tag is looked for with and without
the `v` prefix, since sprints declare `1.4.0` and projects tag either way.

It carries `sprint_shipped=` rather than joining `sprint_drift=` (which counts
plans whose `Sprint:` field disagrees) or `sprint_index_drift=` (which counts
sprints whose phase disagrees with the index). Three questions, three numbers,
and the fixture proves they are three: 5 index findings against 4 release ones
over one set of files, with different populations.

It sits below `== blocking sections end ==` and stays out of `attention=`. A
delivery stopped by this would be stopped by somebody else's paperwork.

<!--
plan: docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md
bumps:
  skills:
    plot: minor
-->
