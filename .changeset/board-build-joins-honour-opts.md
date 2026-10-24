---
"@plot-pm/board": patch
---

Fixed `boardState` sharing one in-flight build across callers with different options, and handing a late joiner a stale answer after refs moved (#2097). The shared slot is now keyed by the caller's `repoRoot`, `scriptsDir`, and every injected port in `BuildBoardOptions`, so two concurrent callers reading different estates never join the same build. A joiner arriving after the ref state has moved since the in-flight build started gets a fresh build instead of the stale in-flight one. A new test proves a failed shared build rejects every joined caller.

<!--
plan: docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md
bumps:
  skills:
    plot: patch
-->
