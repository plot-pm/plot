---
'plot': patch
---

fleetd stops on SIGTERM and SIGINT, so `.plot/fleet.sock` is removed on a `kill`. A channel bind that failed at start is retried on the PR beat, and the monitor and relay of the channel it binds replace the `null` ones. A subscriber's throw in the fleet clock now warns with the subscriber's name instead of vanishing. The PR beat and the desk-relay beat are exported functions with tests for their order, a null channel and a relay throw.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
