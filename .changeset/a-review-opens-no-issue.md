---
'plot': patch
---

`plot-review` opens no follow-up issue for any finding, HIGH included. Every finding now goes into one PR comment, keyed by a per-PR marker so a later run on the same PR edits it instead of duplicating it; a host that cannot take PR comments, or a failed post, still writes the `plot/review` status and exits 4.

<!--
plan: docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md
bumps:
  skills:
    plot: patch
-->
