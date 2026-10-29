---
'@plot-pm/board': patch
---

`runRelease`'s shared-issue sibling read now reads the booking worktree `tmpwt`, and runs before `cleanup()` removes it, instead of reading the main checkout afterward. Two plans sharing one issue that release in sequence without the main checkout being re-fetched between them previously left the second release believing the first was still unfinished, so the issue never closed; the booking worktree is cut fresh from `origin/<main>` for each release and always sees every prior push.

<!--
plan: docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md
bumps:
  skills: {}
-->
