---
'@plot-pm/board': patch
---

registryd-main.ts and worker-loop.ts no longer import any board module outside entry/, proven by an esbuild metafile test rather than bundle-text grep — fleet-settings.ts and release-claim.ts split into an HTTP half and a reader half, and 13 modules the test still flagged by path moved into a new packages/board/src/shared/ directory.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot: patch
-->
