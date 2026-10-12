---
'plot': minor
---

`## Plot Config` accepts a `Workflow phases` key that declares the workflow phases and the plan states and story statuses each holds, and the domain parses it with `parsePhaseMap`; a repository that declares none gets the five default phases, and `PHASE_WORKFLOWS` is derived from the declared map.
