---
'@plot-pm/board': patch
'plot': patch
---

A `waiting` or `blocked` branch reads as unbegun only where the state under it is `open`. The fleet scan now emits each branch's `own_state`, the state before its `waits:` prerequisite, from a third column of `plot-branch-state.mjs`, and `hasNoWork` reads it: a held branch over `unknown`, or from a scan with no `own_state`, is not unbegun, because the host could not say it is empty. A `waiting` or `blocked` branch waits on `time` even in an eligible slice and names no blocking slice. Follows #1302.
