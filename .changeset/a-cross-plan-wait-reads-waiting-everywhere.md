---
'plot': patch
---

A `<!-- waits: … -->` prerequisite reads the same in every mode. `plot-fleet-scan.sh <slug>` and `plot-dispatch.sh <slug>` now look a prerequisite up in the whole estate's slices, as the full scan does, so an unstarted slice of another plan reads `waiting` instead of `blocked — no PR found`. A deferred slice, and a slice of a delivered, released, rejected or superseded plan, no longer counts: with no pull request it reads `blocked`, and with a merged one it clears as before. `plot-fleet-scan.sh --slice-names` prints the set, and `plot-dispatch.sh` asks it instead of reading its own plan (#1305).

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
