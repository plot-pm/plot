---
'plot': patch
---

`bounded-run-group-stop.test.ts` raises its per-test timeout to 20 s on the group-stop, caller-exit, bound-fires and three signal tests, so vitest's 5 s default no longer races the 10 s readiness wait plus the 5 s exit wait inside each test — reproduced under CPU load as `Test timed out in 5000ms` at 2026-10-21 (run 39652704158) and 2026-10-23 (run 39920891443).

<!--
plan: docs/plans/2026-10-23-bounded-run-group-stop-test-times.md
-->
