---
'plot': patch
---

CI gains a `process-census` job: it runs the process census against the pull request and against its merge base, and fails a count that grew past the tolerance its scenario states, or any growth on a strict zero. Census rows record their counts through `recordCensus` in `packages/fleet/test/census/census-report.ts`; `docs/process-census.md` documents the contract and the macOS manual measurement.

<!--
plan: docs/plans/2026-11-08-process-census-gate.md
-->
