---
'@plot-pm/board': patch
---

The row components leave `AgentList.tsx` into `rows.tsx`, `menus.tsx` and
`marks.tsx` under `lib/agent-rows/`, beside the derivations that moved in wave
one. The shell drops from 5958 lines to 1743 and holds the `AgentList`
component, its hooks, and re-exports for the symbols tests read by name.

A pure move: every component is byte-identical to its previous form apart from
the `export` keyword the split requires.
