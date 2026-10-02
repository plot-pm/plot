---
'@plot-pm/board': patch
---

A desk whose worker moved to another desk no longer reads `running`. The registry asks the new domain rule `deskWorker`: when a manifest records the desk's `.plot-worker.pid` pid at a different worktree, the old desk reads `ended`, and the WORKING count and `fleetControls.working` count that worker once.
