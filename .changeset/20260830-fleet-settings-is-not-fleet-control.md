---
'@plot-pm/board': patch
---

`fleet-controls.ts` becomes `fleet-settings.ts`, freeing `controllers/` for the
layer that follows.

Two modules whose names differed by one letter — one holding the two settings an
operator sets, one answering every question about the estate — cost a reader an
hour to tell apart. The module that holds the settings is now named for them.

**Three names deliberately do not move**, because they are contracts rather than
code: the HTTP endpoint `/api/fleet-controls`, the state file
`.plot/state/fleet-controls.json`, and the payload field `fleet.fleetControls`.
Renaming any of them would break a running board or a client mid-poll, and this
slice is a rename with no behaviour change. `FleetControls.tsx` keeps its name
too — it is the surface an operator clicks.
