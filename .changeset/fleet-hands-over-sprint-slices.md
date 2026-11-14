---
'plot': patch
---

fleetd hands a free agent a slice whose plan lives only on a sprint branch (`sprint/<slug>`). The queue reads such a plan from that branch, the brief gate reads its brief there, the agent cuts the slice branch from `origin/sprint/<slug>`, and `plot-open-pr.sh` opens the slice PR against that sprint branch when no `--base` is given. A sprint branch the default branch already contains reads no plan. A plan on the default branch is queued, gated and cut as before.
