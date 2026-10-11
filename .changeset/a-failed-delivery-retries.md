---
'plot': patch
---

A failed automatic delivery now drops its in-flight mark so the next pass retries it, the in-flight file is rewritten only when its set changes or a mark nears expiry, the delivery rules move to the domain package, and the board's unused machine-reading copy is deleted.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot: patch
-->
