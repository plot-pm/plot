---
'@plot-pm/board': patch
---

fleetd, the board and the agent loop read a desk's uncommitted files, its quiet time and its `PLOT-BLOCKED` markers with `git` and the filesystem, instead of a `bash` process that sources `plot-worker-state.sh`. On the census fixture with 3 desks this removes 37 of the 38 remaining sourcings of `plot-worker-state.sh` per idle pass. The dirt filter is the domain rule `deskDirtFilter`, held against the shell's `plot_worker_dirty_filter` by a corpus test.

<!--
plan: docs/plans/2026-11-09-desk-probes-in-domain.md
-->
