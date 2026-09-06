---
'@plot-pm/board': patch
---

The supervisor performs the hand-overs it decides. A tick reported `handed=8` while all eight agents stayed free, because the applier filtered to `worker-start` and skipped every `agent-assign`. Six were written into their manifests by hand, twice in one day. The assignment is now a `Performer` operation, and it refuses an agent that took other work between the reading and the write.
