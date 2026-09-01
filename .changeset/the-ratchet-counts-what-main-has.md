---
'@plot-pm/board': patch
---

Tighten the read-route spawn ratchet from three to one. Two of the three synchronous spawns it counted are already migrated on main, so the assertion refused every board PR while main's own source had moved past it.
