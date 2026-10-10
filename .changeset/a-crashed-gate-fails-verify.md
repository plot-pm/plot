---
'plot': patch
---

`plot-install-hooks.sh --verify` probes a gate again when a signal ends the probe, and reports a gate that a signal ends twice as `unverified` with exit 3, because Claude Code reads that exit as non-blocking and the gate permits every write.

<!--
bumps:
  skills:
    plot-init: patch
-->
