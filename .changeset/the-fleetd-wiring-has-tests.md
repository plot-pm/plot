---
'plot': patch
---

fleetd stops on SIGTERM and SIGINT: the signal ends the wait between ticks, the daemon stops its clock and its channel and exits, so `.plot/fleet.sock` is removed on a `kill` and a launchd `bootout` no longer waits 20 s for SIGKILL. A second signal exits at once. The desk relay runs after a failed tick as well as after a completed one, so desk findings keep reaching the channel while ticks fail. A channel bind that failed at start is retried on the PR beat, and the monitor and relay of the channel it binds replace the `null` ones. A subscriber's throw in the fleet clock now warns with the subscriber's name instead of vanishing. The PR beat and the desk-relay beat are exported functions with tests for their order, a null channel and a relay throw, and `run()` takes seams that let tests drive its loop: the relay on both tick paths, the bind retry, the channel stop and a stop during the wait.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
