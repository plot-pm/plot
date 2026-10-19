---
'plot': patch
---

`continueOnDesk` now refuses a continuation that would push a slice at or past its `Slice max runs` or `Slice max spend` limit — the same limit a fresh dispatch already obeys, now closed for the one path that bypassed it (#1381). The limit wins unconditionally; there is no bypass for a person's answer. The command runner's correction append is now idempotent: a continuation answer gets its own `## Continuation answer` heading in `PLOT-CORRECTION.md`, and a retry or restart that finds the heading already present appends nothing a second time (#1382, #1383). `readContinuation` now distinguishes a missing continuation file from one present but unreadable, rather than reading both as absent (#1383). `CONTINUATION_NAME` moved to its own leaf module with no sibling imports, so a caller that only needs the filename does not pull in the rest of `continueOnDesk`'s dependency graph.

<!--
plan: docs/plans/2026-10-17-manifest-retry-and-race-findings.md
-->
