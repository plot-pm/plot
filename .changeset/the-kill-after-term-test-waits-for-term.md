---
'plot': patch
---

The KILL-after-TERM test of `killGroup` reads a line the TERM-ignoring child prints from its TERM trap, instead of probing it with `kill -0` after the leader's exit event, which under CI load arrived after the KILL and failed the test (#1571).
