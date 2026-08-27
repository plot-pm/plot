---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

`plot-fleet-scan.sh` parses the plan estate once per scan instead of once per
plan.

The scan spawned a process per plan twice over: `plot-plan-meta.sh` to parse
each plan, then a fresh `python3` per plan to re-parse that helper's own output.
`plot-plan-meta.sh` already takes a list — `board.ts` has called it that way for
months — and the scan was the caller that did not.

Measured on this repo, `--offline`, before and after:

| | before | after |
|---|---|---|
| `python3` spawns | 463 | 1 |
| `plot-plan-meta.sh` spawns | 319 | 1 |
| CPU (user+sys) | 22.74 s | 5.74 s |
| wall clock | 26.46 s | 8.62 s |

Four times less CPU. The scan's output is unchanged: a full `--json` run before
and after differs only in the fields that must differ between two runs — each
checkout's own head SHA, elapsed-second counters, and one live worker-activity
sample. No verdict, plan, wave or branch state moves.

A malformed plan still does not take the estate down; the batch call reports
what it could read.
