---
'@plot-pm/board': patch
---

A stalled worker needs a person

**The companion to `working-lists-the-live-agents`.** WORKING now shows only
live workers (`running`, `waiting`), and this wave routes the broken ones —
`stalled` and `unknown` — to WAITING ON YOU as problem reports.

A `stalled` entry is work on the floor with no PR. An `unknown` entry is a
question the board cannot answer. Both say *go look at this* — exactly what
WAITING ON YOU exists to say.

`brokenAgentRows` mirrors `workingAgentRows`: filters to `isBrokenState` (an
allowlist of the two broken states), joins to branch rows by the same rule,
and returns the same shape. The caller renders each as a `RegistryRow` in the
WAITING ON YOU section, where the state badge and worktree path make the
problem visible.

`finished` is neither live nor broken — it is not a worker, and it is not a
problem. The PR carries the work; the entry drains through reconciliation.

<!--
bumps:
  skills: {}
-->
