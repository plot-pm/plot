---
'@plot-pm/board': patch
---

The board moves the action records an older Plot wrote beside the checkout (`plot-<kind>-<id>.log`, `.state`, `.prompt.md`) into the desk root once, at startup, before any action writes a new one. With no `Worktree root` configured they land in `<repo>/.worktrees`, and the checkout's parent holds no Plot file afterwards.

<!--
plan: docs/plans/2026-10-01-plot-keeps-its-files-inside-the-repository.md
-->
