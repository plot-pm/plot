---
"@plot-pm/board": patch
---

The board parses the plan estate once per default-branch head instead of once per call, so `planStatusBySlug` outside a render pass no longer repeats the full parse. The checkout-cleanliness check takes no git index lock and ignores untracked files, and `buildBoard` drops a branch-plan guard that `planSources` already covered.

<!--
plan: docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md
bumps:
  skills: {}
-->
