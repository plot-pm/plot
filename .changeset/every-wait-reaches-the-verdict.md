---
'plot': patch
'@plot-pm/board': patch
---

`waitVerdict`, `prerequisiteCleared`, the queue's `waits` hold, `PlanRecordBranch.waitsOn`, `BranchSchema.waits_on` and the fleet row's prerequisite sentence all take a list of prerequisites instead of one name, so a slice naming two `waits:` branches is no longer silently read as naming only the last one `plot-plan-meta.sh` emitted.

Measured on `main`: a plan declaring two prerequisites kept only the last `<!-- waits: … -->` comment, because every domain and board reader took `waitsOn` as a single string. This slice changes every reader to a list while the parser and the scan still send one name each — behaviour on `main` is unchanged until `the-parser-reads-every-wait` (slice 2) teaches the scan to emit several. `BranchSchema.waits_on` reads both wire shapes, so a persisted `.plot/state/last-pulse.json` from before this change still parses.

The board's row sentence now names every declared prerequisite rather than only the one still holding the slice, because the pulse carries no per-prerequisite verdict — only the plan's declaration. A `blocked` row with several prerequisites reads "one of which has no pull request" rather than naming one as if it were alone.

<!--
plan: docs/plans/2026-10-02-a-slice-waits-on-every-branch-it-names.md
bumps:
  skills:
    plot: patch
-->
