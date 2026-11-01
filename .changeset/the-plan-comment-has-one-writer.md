---
'plot': patch
---

The plan-state comment on a tracked issue has one writer at a time: a write that cannot take the per-issue lock fails and leaves the other writer's lock in place, a failed read-back fails the write instead of erasing the ticket and progress lines, the marker lookup matches the comment whichever account wrote it, and a late approved progress write skips a comment that already says delivered or released.

<!--
bumps:
  skills:
    plot: patch
-->
