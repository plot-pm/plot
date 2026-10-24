---
"@plot-pm/board": patch
---

Added `plot-record-pr.sh`, replacing the prose instruction that told a dispatched agent to append a slice's PR number to its plan line by hand-editing the main checkout and committing from elsewhere (#2461): measured 2026-10-23, that split the write from the commit across two trees, leaving the main checkout permanently and silently dirty. The new script cuts a disposable worktree from `origin/<default>`, edits and commits the plan file inside it, pushes, and never opens the main checkout — modeled on `write_started_record` in `plot-dispatch.sh`. The line transform itself lives in `packages/domain/src/rules/slice-pr-annotation.ts` and is asked through `board/plot-slice-pr-annotation.mjs`, per *A Shell Script Asks The Domain*.

<!--
plan: docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md
bumps:
  skills:
    plot: patch
-->
