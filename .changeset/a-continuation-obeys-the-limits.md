---
'plot': patch
---

`continueOnDesk` now refuses a continuation that would push a slice at or past its `Slice max runs` or `Slice max spend` limit, the same limits a fresh dispatch obeys (#1381). The limit wins; a person's answer does not bypass it. Both checks run before a free-waiting loop is stopped, so a refused continuation leaves that loop running. The run count comes from the desk's existing manifest; where the desk has no manifest and `continueOnDesk` writes a new one, only `Slice max spend` is checked. On the command runner, each continuation answer gets its own heading in `PLOT-CORRECTION.md`, keyed by a hash of the answer text: a retry or restart that reads the same answer appends nothing, and a second, different answer in the same slice is appended and reaches the resumed session (#1382, #1383). `readContinuation` distinguishes a missing continuation file from one present but unreadable, and the loop logs the unreadable case (#1383). `CONTINUATION_NAME` moved to its own leaf module with no sibling imports.

<!--
plan: docs/plans/2026-10-17-manifest-retry-and-race-findings.md
-->
