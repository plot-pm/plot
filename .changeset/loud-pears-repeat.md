---
'@plot-pm/board': patch
---

The board binds both loopback families, so a browser resolving `localhost` to IPv4 reaches it rather than reporting a refused connection. Measured 2026-09-11: `lsof` reported `TCP [::1]:7777 (LISTEN)` while the page showed no contact for 18 polls, against a healthy process. Two listeners share one port and one request handler; the wildcard stays refused, and an explicit `HOST` is left alone.

<!--
plan: docs/plans/2026-09-11-the-board-answers-where-the-browser-asks.md
-->
