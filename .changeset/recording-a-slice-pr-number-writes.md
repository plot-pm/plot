---
"@plot-pm/board": patch
---

Added `plot-record-pr.sh`, replacing the prose instruction that told a dispatched agent to append a slice's PR number to its plan line by hand-editing the main checkout and committing from elsewhere (#2461): measured 2026-10-23, that split the write from the commit across two trees, leaving the main checkout dirty. The script is a launcher over `board/plot-record-pr.mjs`, which cuts a disposable worktree from `origin/<default>`, edits, commits and pushes the plan file inside it through the shared commit-and-push ladder, and never opens the main checkout. The plan lookup and the line transform are domain rules: `rules/plan-for-branch.ts` and `rules/slice-pr-annotation.ts`.

<!--
plan: docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md
bumps:
  skills:
    plot: patch
-->
