---
'plot': patch
---

fleetd hands a free agent a slice whose plan lives only on a sprint branch (`sprint/<slug>`). The queue reads such a plan from that branch, the brief gate reads its brief there, and the agent cuts the slice branch from `origin/sprint/<slug>`. A plan on the default branch is queued, gated and cut as before.
