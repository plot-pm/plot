---
'plot': patch
---

The `Worker bound` entry in the `plot-config.sh` header says that the default is 28800 seconds (eight hours), not 3600, and describes the key as the floor under the worker monitor. The `Slice max runs` entry says that the limit counts runs on both runners. The `plot-dispatch` and `plot-fleet` texts and the `plot-fleetctl.sh` stop message name eight hours as the default, not as a fixed value.

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
    plot-fleet: patch
-->
