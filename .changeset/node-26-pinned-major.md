---
'plot': minor
---

Plot's pinned Node major moves from 24 to 26 (`.nvmrc`, every `engines` block, CI and release). The fleet helpers read the pin from `.nvmrc` and refuse a node on PATH with a different major, so a Plot that runs the fleet needs Node 26 from this release. The fleetctl test fixture now defaults its sandbox pin to the running node's major instead of a hardcoded 24.
