---
"plot": patch
---

The installed supervisor hands work over. Both shipped units named `__NODE__ __REGISTRYD__` and nothing else, so a daemon started from either one computed every hand-over and performed none — `startAgents` walks `report.handOver.writes` only behind `--start-agents`, and the flag defaults off so `/plot-fleet --once` can run against a live estate for free. Measured 2026-09-07: three consecutive ticks reported `handed=2` while both free agents' manifests read `branch: ""` and had been quiet 3,067 seconds. Both units carry the flag now, because a fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations. The launchd unit also drops `ProcessType: Background`, which buys scheduling priority and eviction eligibility together where the reasoning in its own comment asks for the first alone: the job was evicted six times in one session, every one under load and caught at load 43.68, with `runs = 1`, `never exited` and a 0-byte `registryd.err` each time, while `node --watch board-server.mjs` ran 2 days 12 hours unbroken through all six on the same machine. `Adaptive` keeps it schedulable and `Nice` carries the politeness. The systemd unit's `Nice=10` and `IOSchedulingClass=idle` are priority alone and evict nothing, so its priority is unchanged and the plist comment says why. The new tests read the unit templates rather than the parser — `argsFrom` has parsed the flag correctly since it existed, and what went unread for the life of the feature is the unit file. An installed unit does not update itself: `/plot-fleet` now states that `--stop` then `--start` re-fills it, and names the symptom.

<!--
plan: docs/plans/2026-09-07-the-installed-supervisor-hands-work-over.md
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
