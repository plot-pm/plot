---
'@plot-pm/board': patch
---

The deliverability controller asks ports instead of running scripts.

`deliverabilityOf` ran `plot-plan-meta.sh` and `plot-impl-status.sh` itself,
which inverts the layering rule: a controller calls the domain, an adapter calls
the script, and only an adapter may. Both readings already had ports —
`PlanStore.readPlan` and `Host.prMerged` — so nothing was designed, only
rewired. The estate gains a `host` port with a fixture, so the mock board
answers the question without spawning either.
