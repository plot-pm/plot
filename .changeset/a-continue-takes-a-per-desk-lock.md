---
'plot': patch
---

`continueOnDesk` now takes a per-desk lock around the live-loop check, the spawn, and the pid-file write, so two `POST /api/continue` calls racing the same worktree start exactly one loop instead of two — the second now reads the existing `loop-alive` refusal (#1357). The spawn's `'error'` handler settles the call with `failed` and releases the lock instead of leaving both hanging forever, which a missing `sh` binary could previously trigger. `.plot-worker.freewait`'s filename is now defined once (`FREE_WAIT_FILENAME`, imported by both the domain adapter and the lock rule) instead of twice, and a continuation that stops a free-waiting loop now removes the freewait file so a new loop does not read `waitsFree` for a pid that no longer exists (#1377).

<!--
plan: docs/plans/2026-10-17-manifest-retry-and-race-findings.md
-->
