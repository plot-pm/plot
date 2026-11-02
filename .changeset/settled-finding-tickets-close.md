---
'plot': patch
---

A new operator command, `plot-finding-tickets.mjs`, closes a `plot-review: findings on` ticket when a recorded verdict settles every finding it counts, comments once on a ticket whose verdict still holds a true finding, and leaves a ticket with no complete verdict alone. A merge never closes a ticket. The Tracker port gains a closing-only `issueClose`.

<!--
bumps:
  skills:
    plot: patch
-->
