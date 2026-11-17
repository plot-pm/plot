---
'plot': patch
---

A `waits:` prerequisite with no remote ref now reads merged where the PR index holds a merged row for it and no open row, in any plan. The pulse marked such a prerequisite `merged` while a slice in another plan kept reading `waiting` on it, because the fleet's reused PR listing held no merged row, so the dispatch controller refused the slice.

<!--
bumps:
  skills:
    plot: patch
-->
