---
'@plot-pm/board': minor
---

Builds `plot-branch-state.mjs`, the twelfth bundle: the domain's derivation of a branch's state, reachable from the scan that reads it without starting a board. One call per plan rather than one per branch, because the board polls the scan every five seconds against ~40 plans. Registered in `.gitattributes` as `-merge` and in `BOARD_ARTIFACT_PATHS`, so a conflict in it resolves by rebuilding.
