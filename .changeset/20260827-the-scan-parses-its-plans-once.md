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
months, with a docstring that says so — and the scan was the caller that did
not.

The estate is now parsed once, before enumeration, and every later question
reads that one result: the phase that groups a plan, the `Delivered:` window
test, and the wave/branch flattening. What those rules decide is unchanged; only
the number of processes deciding it is.

Measured on a frozen 154-plan clone, old and new back to back, `--offline` on
both sides so the host wait stays out of the comparison:

| | before | after |
|---|---|---|
| `plot-plan-meta.sh` spawns | 319 | 1 |
| `python3` spawns | 463 | 1 |
| CPU (user+sys) | 21.2 s | 5.0 s |
| wall clock | 23.5 s | 6.7 s |

A quarter of the CPU. Three consecutive repetitions varied by under 0.4 s,
against the 1.8 s noise band the plan documented.

The scan's output is **byte-identical**, verified on that frozen estate across
all four consumers: `--json`, the plain report, `--next` and `--list-eligible`.
No verdict, plan, wave or branch state moves. No host call is added or removed,
and `--offline` still makes none.

A malformed plan still does not take the estate down: the batch call decodes
each JSON line independently, so one unreadable plan costs only itself and the
scan reports what it could read.
