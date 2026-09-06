---
'plot': patch
---

The merge lookup keeps its own `gh` call, and the exemption now rests on a measurement rather than a date. `plot-host.sh pr-merged` reports an absent CLI as `not-merged` where `plot-pr-merged.sh` reports `unaskable` — `is_lookup_miss` matches the shell's own `command not found` — so routing would turn a keep into a remove on the path that deletes remote refs. Two tests pin it.

<!--
bumps:
  skills:
    plot: patch
-->
