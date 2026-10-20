---
'plot': patch
---

A GitHub Actions run that hit its own `timeout-minutes` cap now settles as `build timed out` instead of idling to `no-answer` for the full `Checks wait` bound. `runWasTimedOut` reads the step fingerprint — one or more `success` steps, then exactly one `cancelled`, then the rest `skipped` or `success` (GitHub's own "Post " cleanup steps run regardless of why a job was cancelled) — plus each job's elapsed time, both from the same `gh run view --json jobs` call `runWasNotAcquired` already makes. Elapsed time is required because a forced, confirmed concurrency supersession produced the identical step shape as a confirmed 25-minute timeout; a host-outage run and a supersession still read as unsettled.

<!--
plan: docs/plans/2026-10-19-validate-runs-at-86-of-its.md
bumps:
  skills:
    plot: patch
-->
