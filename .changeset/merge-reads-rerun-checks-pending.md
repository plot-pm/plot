---
'plot': patch
---

`plot-ask.mjs merge` and fleetd's merge arm require every check named in the new `Merge checks` config key to have a completed `success` on the pinned head. A named check with no run on the head, or with a queued or running run, reads `pending` and refuses `checks-not-green`; one that completed with any other conclusion reads `failing`. `plot-host.sh pr-state` now reports every rollup item as `checkRuns`. Plot's own config names `validate`, which a `gh run rerun --failed` removes from the rollup until it runs again (#3368).
