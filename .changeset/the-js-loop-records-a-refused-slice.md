---
'@plot-pm/board': patch
---

The JS worker loop records a refused slice. A desk reset refused at take-up appends the branch to `.plot/state/refused-slices.tsv` under the common git dir, once per branch, so the queue holds the slice instead of handing it to the next free agent. The shell loop's `record_refused_slice` was the only writer before, and on 2026-10-03 one refused slice went to free agents 250 times. The queue's `refused` reading now reads the same file through the same adapter; before, it read the checkout's own `.plot/state/` and missed the writer's line.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->
