---
'plot': minor
---

The worker loop ends a prompt when the WorkerMonitor reports `idle`, not after
N wall-clock seconds. Seven workers exited 124 on 2026-08-30 and every one had
3-6 commits — the bound answered *hung* seven times and was wrong seven times,
taking a different last step from five of them (three the PR, two the
changeset, one the artifact rebuild). The timer survives as a floor, with its
default raised from 3600 to 28800: it now fires only when the monitor itself
has died. `Worker bound: 0` still disables the floor and no longer disables the
reading.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
