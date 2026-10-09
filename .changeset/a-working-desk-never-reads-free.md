---
'plot': patch
---

`assignSlice` writes a slice's hand-over branch to the `Agent registry` path a repository configures, not to the hardcoded default. A registry configured elsewhere left the written branch where the worker loop never read it, so the loop counted a free wait while its agent worked and ended it at the bound (#1409).

<!--
plan: docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md
bumps:
  skills:
    plot: patch
-->
