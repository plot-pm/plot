---
'plot': patch
---

The fleet daemon waits for its in-flight scan and PR refresh before it returns on a stop. A scan that started before the stop runs its automatic writes to the end, so nothing writes `.plot/state/` after the daemon has stopped.
