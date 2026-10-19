---
'plot': patch
---

An unstarted continuation now resumes the handle its own ending recorded (`resumeId`) instead of scanning the worktree's transcript directory for the newest file, which could name a different slice's conversation in a worktree reused across dispatches (#1788). The transcript scan remains the fallback for an ending that recorded no handle.

<!--
plan: docs/plans/2026-10-17-manifest-retry-and-race-findings.md
bumps:
  skills:
    plot: patch
-->
