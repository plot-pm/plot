---
'plot': patch
---

`plot-fleet-scan.sh` is a launcher of 25 counted lines (was 2,181): it parses the mode flags, fetches `origin` and runs `board/plot-scan-walk.mjs`. The domain walk gains the bare prose mode, the carried-listing read and the `listing:` stderr report. Eight shell-versus-domain corpus pairs are retired: `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible`, `finished-estate`, `refs`, `scan-listing` and `tracked-branches`. `PLOT_SCAN_WALK` is removed. The domain walk takes over what the shell walk did for the scan's own callers: it reads its own PR listing (`--state open --rich` and `--state settled`, with the page-complete claims, `PLOT_PR_LIST_LIMIT` and `host=partial`), asks `pr-state` once for each branch with no ref and each `waits:` prerequisite the listing does not answer (`PLOT_SCAN_ASK_ALWAYS=1` asks them all), asks the host about the subject-proven branches of a delivery candidate, counts `local_ahead` for a local branch with no worktree, reads the worker log as evidence of work, reports `subjectIgnored` and `subject_predates_plan`, prints the host notes, skips a prefix branch whose tree cannot be read, and keeps going when `.plot/state` cannot be written.

<!--
plan: docs/plans/2026-10-31-the-plan-walk-moves-into-the.md
bumps:
  skills:
    plot: patch
-->
