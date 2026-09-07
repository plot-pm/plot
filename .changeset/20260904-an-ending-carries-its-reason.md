---
'plot': patch
'@plot-pm/domain': patch
---

A worker now records why it ended, not only that it did. `_ended_detail` was set by whichever trap fired and written nowhere — no file, no stdout — so the distinction it drew lived for the length of one stderr line and reached no reader that outlived the process. `.plot-worker.ending.json` gives it a channel: a reason, an actor, the branch held at the time, and the sentence naming the reading. Four reasons, and a bound expiry is no longer the same ending as a context exhaustion; `unreadable` stays apart from `bound` because both are the floor firing and they differ in what could be read while the worker ran, not in what stopped it.

<!--
bumps:
  skills:
    plot: patch
-->
