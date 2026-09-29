---
'@plot-pm/board': patch
---

`POST /api/dispatch` names the act it performed instead of answering a bare success: the 202 body is now `{ act: 'implement-started', slug, status, dispatchLog, implementLog }`, where `status` points at `GET /api/implement/<slug>` and the log field is qualified because the dispatcher log is written only if the implement exits 0. Measured 2026-09-27, the old body answered the same for four desks of which two had live workers and one carried `exit=124`.

<!--
plan: docs/plans/2026-09-27-a-dispatch-promises-a-worker.md
-->
