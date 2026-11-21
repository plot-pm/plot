---
'@plot-pm/board': patch
---

The brief-ask test's usage-limit cases pin `Date` at 2026-11-05T22:00:15Z, so they no longer fail between 23:00 and 23:02 Berlin time (#3125). The limit stub resets at 1am Berlin and both cases assert the exact reset epoch, and a third case asserts that a reset 15 s in the past resolves to the pinned now.

<!--
plan: docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md
-->
