---
"@plot-pm/board": patch
---

The PR status banner now shows a secondary (429) refusal's own backoff end instead of staying silent, reads missing credentials as `error` whether or not data is on screen, matches a credential-source notice to the end of its sentence instead of stopping after "the" (which left "environment" behind as a false outage cause), and extracts the `BITBUCKET_REVIEW_USER` credential notice in full. The notices-only banner no longer claims the host reported no failure while `hostAnswer` calls the same reading unreachable, and the comments claiming `prIntervalMs` never varies now describe `scheduleNextPr`'s per-backend stretch.

<!--
plan: docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md
bumps:
  skills: {}
-->
