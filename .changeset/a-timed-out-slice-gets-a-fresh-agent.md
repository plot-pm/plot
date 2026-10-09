---
'@plot-pm/board': minor
---

A desk whose worker ended `bound` (the wall clock ran out) or `unreadable` (the clock ran out and nothing could say why) now gets a fresh agent when it still holds a commit beyond its claim, an open PR, or a dirty tree — the registry tick reads the branch's real facts instead of filler, names every held file in the fresh agent's answer, and shares its one fresh session per slice with `corrections-spent`, `turn-limit` and an after-prompt `holding-work`. A branch with nothing beyond its claim still has that claim released, and a merged branch starts no fresh agent at all. Before this, the ending existed but nothing acted on it: the supervisor left a timed-out desk with 50 uncommitted files sitting claimed, continuing and dispatch both refused it, and a person had to commit the tree by hand.

<!--
plan: docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md
bumps:
  skills:
    plot: patch
-->
