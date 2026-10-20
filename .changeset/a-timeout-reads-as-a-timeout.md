---
'plot': patch
---

A GitHub Actions run that hit its own `timeout-minutes` cap now settles as `build timed out` instead of idling to `no-answer` for the full `Checks wait` bound: `runWasTimedOut` reads the measured fingerprint — one or more `success` steps, then exactly one `cancelled`, then the rest `skipped` — from the same `gh run view --json jobs` call `runWasNotAcquired` already makes, so a host-outage run and a concurrency-superseded run still read as unsettled.

<!--
plan: docs/plans/2026-10-19-validate-runs-at-86-of-its.md
bumps:
  skills:
    plot: patch
-->
