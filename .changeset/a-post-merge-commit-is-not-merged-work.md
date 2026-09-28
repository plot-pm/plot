---
'plot': patch
---

The reaper keeps a desk holding a commit made after its PR merged, including on a squash merge where the merged head exists nowhere in the branch's history. It reads `git cherry` against the default branch and keeps the desk on any commit whose patch is not upstream; an unreadable base keeps the desk too.

<!--
plan: docs/plans/2026-09-28-a-post-merge-commit-is-not-merged-work.md
-->
