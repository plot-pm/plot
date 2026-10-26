---
"plot": patch
---

`/plot-implement` steps 4 and 5 now fetch `origin/<default branch>` immediately before writing the brief commit and the `Started:` commit — not only at step 2's plan-staleness preflight — and write no second brief commit when `origin/<default branch>` already holds one for the slug. A rejected push recovers by re-cutting in a disposable worktree, the same shape `plot-dispatch.sh`'s `write_started_record` uses, never by a mixed `git reset`. This closes defects 1 and 2 of the mixed-reset incident; the gate that refuses the mixed reset itself (PR #2640) is unchanged — this slice makes the run never need that refusal.

<!--
plan: docs/plans/2026-10-24-a-mixed-reset-leaves-the-main.md
bumps:
  skills:
    plot-implement: patch
-->
