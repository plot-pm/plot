---
'plot': patch
---

`plot-reap`'s branch kind keeps a local branch whose tip carries a commit added after its PR's merged head, and keeps a contained branch with no commit of its own for a person to decide. Previously, a branch reported `merged` by the host was deleted even when a later unpushed commit sat on its tip, and containment alone — true for a branch that never diverged from the default branch, not only for a genuinely merged one — was enough to delete a local ref.

<!--
plan: docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md
bumps:
  skills: {}
-->
