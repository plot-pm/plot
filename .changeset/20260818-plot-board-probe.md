---
"plot": patch
---

Add `plot-board-probe.sh`: a strictly read-only probe that emits one JSON
object describing whether the Plot board can run in the current repository —
node version, repo shape, board artifact location, Plot Config presence, plan
count, CI signals, and CLI auth states.

The probe decides nothing. Which artifact to recommend and what an empty board
means are the consuming skill's judgment, not the script's (Manifesto
Principle 3).

Two details are load-bearing:

- The artifact is resolved by *structure*, not by sorting. `marketplaces/` is
  the installed copy and `cache/<version>/` is history, so the former is
  matched explicitly and newest-mtime is only a fallback. Sorting paths picks
  the lexically-last one, and version strings sort so that `2.10.0` < `2.5.0`.
- `auth` is a three-state enum (`ok`/`failed`/`unknown`), never a boolean. An
  unrecognised output reads as *cannot verify*, never as *authenticated*.

<!--
bumps:
  skills:
    plot: patch
-->
