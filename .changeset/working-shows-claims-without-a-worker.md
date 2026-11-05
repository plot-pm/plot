---
'@plot-pm/board': patch
'plot': patch
---

The board lists a claimed or `wip` branch with no known worker under WORKING when its tip is fresh or a local worktree shows activity, with the status word `no known worker`, and no longer under NOT STARTED beside the label `someone is on it`. The new domain rule `unworkedPlacement` decides the section and the startability together. WORKING counts and draws these rows without a pulse and without a worker log. A stale claim or stale `wip` branch with no local activity stays in QUIET. A hand-started worker that holds one of these rows moves it to WORKING as handed over, or to WAITING ON YOU when two sessions name it.

<!--
plan: docs/plans/2026-11-03-board-files-rows-in-the-wrong.md
-->
