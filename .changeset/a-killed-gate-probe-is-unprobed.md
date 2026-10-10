---
'plot': patch
---

`plot-install-hooks.sh --verify` now reports a gate that a signal ended before it answered (exit 128 or more) as `unprobed`, never as a gate that permitted a guarded write. A SIGKILL from outside the probe no longer turns a working gate into an `unverified` one (#1471).

<!--
bumps:
  skills:
    plot: patch
-->
