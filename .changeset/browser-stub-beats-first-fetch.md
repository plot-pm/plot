---
'@plot-pm/board': patch
---

A browser test's `/api/fleet` stub is installed before the page navigates, so it cannot lose to the server it replaces.

<!--
plan: docs/plans/2026-09-07-a-browser-stub-beats-the-first-fetch.md
-->
