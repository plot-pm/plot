---
'plot': minor
---

A reusable panel: N agents read one plan through different lenses, each writing a verdict file that must carry a committed position, reconciled by a moderator that names disagreements rather than averaging them. `/plot-panel` is a mechanism rather than a lifecycle step — it moves no phase and decides nothing. The part that is more than parallel subagents is the gate: a verdict file naming no position is refused, because fan-out, file-writing and reconciliation all work perfectly with the gate absent and the panel still produces N files and a summary that look finished. The commitment vocabulary belongs to the caller — `proceed/amend/reject` for a Draft juror, `supported/refuted` for a delivery one — and the mechanism knows neither, since hardcoding one is what makes the second caller impossible. Four hedges are refused, each a shape a juror writes: no line at all, a word outside the vocabulary, an empty file, and two different positions in one file, where taking the first line or the last would each let it through. Verdict files are tracked under `.plot/panels/<subject>/` rather than the reaped `.plot/state/`, so a panel's reasoning outlives its worktree.

<!--
plan: docs/plans/2026-09-12-a-panel-questions-one-plan.md
bumps:
  skills:
    plot-panel: minor
-->
