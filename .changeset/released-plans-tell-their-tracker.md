---
'@plot-pm/board': patch
---

A release now closes the GitHub issue it names, through the same tracker calls the delivered phase already makes — `runRelease` used to write `tracker=skipped` unconditionally and never call either script, so 63 of 65 plans released on 2026-10-22 kept an open issue. An issue another not-yet-`released` plan still names is left open and reported `another-plan-unfinished`; the release summary gains a second line, `summary: issues closed=<N> left-open=<M> (<reason>=<count> …)`, and a tracker write failure is reported without failing the release.

<!--
plan: docs/plans/2026-10-23-released-plans-leave-their-github-issues.md
bumps:
  skills:
    plot: patch
    plot-release: patch
-->
