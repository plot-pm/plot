---
'@plot-pm/board': patch
---

Route the last synchronous spawns behind their ports. The agent panel asks `Processes` for a pid's uptime and the brief lookup asks through a port, so the read-route ratchet reaches zero: no read route reaches a synchronous spawn, awaits ignored.
