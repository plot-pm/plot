---
'plot': patch
---

A worker-loop test takes its loops with it, so the reconcile suite can exit.

**The cause of the reconcile-suite hang, found 2026-08-31 by instrumenting CI
(#559).** The witness caught it at the moment of the wedge:

```
  28942  1  11:57 S  bash .../plot-worker-loop.sh
  31429  1  11:56 S  bash .../plot-worker-loop.sh
  … 13 of them, PPID 1, aged 10-12 minutes
 185654  54125  00:00 S  sleep 1     <- 14 sleeps held by them
```

Thirteen `plot-worker-loop.sh` orphaned to init, each spinning `sleep 1`. The
TAP stream shows the runner had **finished**: `ok 877 - worker-loop: no stray
sleeps after an idle ending`, this file's last test. Every test passed. Node
cannot exit while descendants hold the process group, so the job sat until its
ceiling killed it — reporting no failing step, because there was none.

`runLoop` spawned the loop into the runner's own process group, so
`child.kill()` signalled one pid and the loop's children survived. It now
spawns `detached: true` — making the loop a group leader — and sweeps the
**group** with `process.kill(-pid)`, both on the timeout path and on exit.

**Verified on macOS only, and that is a real limit.** The file passes 18/18 and
exits clean, and leaves zero processes at PPID 1 — but so does `main` here. The
orphans appear on Linux runners, where reparenting differs. What can be shown
locally is that the change is correct and harmless; that it cures the hang can
only be shown on CI.

<!--
bumps:
  skills:
    plot: patch
-->
