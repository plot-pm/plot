---
'@plot-pm/board': patch
---

`continueOnDesk` no longer refuses a blocked desk whose restarted loop is merely waiting free for a slice: it stops that pid (waiting for exit, so the old loop's own `SIGTERM` cleanup cannot race the manifest this route is about to touch), then continues as before. Every other live loop — one actually working a turn — still refuses `loop-alive`, and the refusal's sentence now says so (#1373).

<!--
plan: docs/plans/2026-10-08-a-blocked-agent-s-question-has.md
-->
