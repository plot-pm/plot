---
'@plot-pm/board': patch
---

fleetd's state-sync tick and `plot-deliver.mjs` start `board/plot-state-sync.mjs`, where `build.mjs` ships it; both asked for `plot-state-sync.mjs` beside the shell scripts, and Node exited 1 with "Cannot find module".
