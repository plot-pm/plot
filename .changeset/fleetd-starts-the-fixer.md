---
'plot': minor
---

fleetd starts the `fixer` role on a sprint slice PR when its review holds a HIGH finding on the current head, or when CI is red on the current head and the desk is dead or has spent its corrections, up to two attempts per PR. Before a start, fleetd re-asks the host for the PR's state and head, creates the fixer's worktree detached at that head, and records the attempt with an in-flight mark. The fixer gets the PR, the head SHA and the review findings or the failing checks as its prompt, and pushes with `git push origin HEAD:<branch>`. While the fixer runs, the PR holds as `fixer-in-flight`; once its process ends, fleetd removes the worktree and clears the mark. A refusal before the launch spends no attempt. The run log records each start, refusal and end as `fixer-start` and `fixer-end` lines.

<!--
plan: docs/plans/2026-10-29-a-high-finding-is-fixed-before.md
bumps:
  skills:
    plot: minor
-->
