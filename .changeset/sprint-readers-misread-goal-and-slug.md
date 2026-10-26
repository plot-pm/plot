---
'plot': patch
'@plot-pm/board': patch
---

Fixed `plot-review-status.sh` dying under `set -e` on an unknown sprint slug — `ls docs/sprints/*-<slug>.md` finding no match now falls through to the script's existing "Sprint file not found" JSON instead of aborting the loop. Fixed the same script reading a sprint item's own `[x]`/`[ ]` checkbox mark as its `[slug]` — the `[slug]` lookup now runs against the line with its checkbox already stripped. Corrected a stale `board.ts` comment that described `sprintGoal` reading the `> ` title line before a bold `## Sprint Goal` label — the domain has read bold first since PR #2043's re-review, and the comment never caught up.

<!--
plan: docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md
bumps:
  skills:
    plot: patch
-->
