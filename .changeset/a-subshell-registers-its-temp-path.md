---
'plot': patch
---

A temp path that `plot-tmp.sh` creates inside `$(…)` or `( … )` is registered before a TERM, INT or PIPE ends that subshell, so the owner's cleanup removes it. bash resets caught traps in a subshell, and a group TERM that landed between `mktemp` and the registration left the path unlisted: CI run 37052327801 left `plot-host-prlist-err.XWmw0r`, which `plot-host.sh`'s `pr_list_call` creates inside `_raw="$(pr_list_call …)"`. In a subshell the creation now records the signal, registers the path, and exits with 128 + the signal's number. A path that exists is also registered when bash 3.2 reports 143 for the `$(mktemp …)` that created it.

<!--
bumps:
  skills:
    plot: patch
-->
