---
'plot': patch
---

`POST /api/interrogate` reads a plan that the default branch holds from a detached worktree of `origin/<default>`, also where the main checkout holds a copy, and its prompt names the default branch as the push target. `/challenge-the-plan` Phase 7b rebases a round onto a moved default branch where the plan file is unchanged, and refuses `plan-file-moved` or `default-branch-moved` by name otherwise. The main checkout is read only for a plan that neither an open plan PR nor the default branch holds (#3536).

<!--
bumps:
  skills:
    challenge-the-plan: patch
-->
