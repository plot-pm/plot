---
'plot': minor
---

A superseded plan has a controller: `plot-supersede.mjs --by <successor-slug> <slug>` marks a Draft, Design or Approved plan Superseded on the default branch. It writes `State: Superseded` and the dated `Superseded:` record, moves the index link to the delivered index, and leaves the state receipt `plot-state-gate.sh` reads. It refuses an unattended caller, a successor that names no plan file, and a plan that names itself.
