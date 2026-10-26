---
'plot': patch
---

The state gate no longer refuses a merge commit whose staged `State:` or `Spike approved:` text matches another parent's version of the same file. `MERGE_HEAD` (read worktree-aware, octopus parents included) now supplies each path's other-parent text, and a transition clears with no receipt when the staged text is byte-for-byte identical to any one of them. A removal is never cleared this way, and a value that matches only after a hand edit to the surrounding text still refuses.

<!--
plan: docs/plans/2026-10-24-the-state-gate-refuses-a-merge.md
bumps:
  skills:
    plot: patch
-->
