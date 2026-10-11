---
'plot': patch
---

A failed automatic delivery now drops its in-flight mark and retries after 60 s, then 120 s, and stops after 3 consecutive failures with a "needs a person" line in the fleet log and the plan's deliver log; a success or a change to the plan's branches resets the count. A delivery mark is renewed only while its delivery runs, so a mark whose delivery died outside the daemon expires after 180 s and counts as a failure. The in-flight file is rewritten only when its contents change or a live mark is 80 s old, the delivery rules move to the domain package, and the board's unused machine-reading copy is deleted.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot: patch
-->
