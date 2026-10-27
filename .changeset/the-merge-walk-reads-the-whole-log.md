---
'plot': patch
---

The wave gate's merge walk no longer caps silently at 2000: `MERGE_SCAN_LIMIT` in `plot-fleet-scan.sh`, `MERGE_WALK_LIMIT` in `registryd-main.ts`, and the corpus default in `readMergeSubjects` all rise to 20 000, 8.5x the largest measured real-estate log (2340 merges on ewz-kus-portal). A new test asserts the three stay equal, since there is no shared constant across a shell script and two TypeScript files to enforce it otherwise. The Bitbucket merge-subject comment is corrected with counter-evidence — 7 of about 70 local clones carry a single-parent `Merged in` commit — and the board's stdin-format doc comment now cites 20 000 instead of 2000.

<!--
plan: docs/plans/2026-10-23-read-merged-prs-from-the-merge.md
bumps:
  skills: {}
-->
