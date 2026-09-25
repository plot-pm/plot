---
'plot': patch
---

The adoption probe reports the host's default branch beside the local one. `plot-detect-repo.sh` read `default_branch` from `origin/HEAD` alone — a cache written at clone time, which a default branch changed afterwards never updates. It now also reports `host_default_branch`, asked through `plot-host.sh default-branch`, with `host_default_branch_status` as `ok` or `unknown`: a host that could not be asked reads `unknown` and never the local answer, because two equal readings would report agreement nobody measured. `default_branch` keeps its meaning and its value, and the probe compares the two nowhere. `plot-host.sh default-branch` now asks the host on Bitbucket too, where it read `origin/HEAD` first and its `bb` fallback was unreachable — the `||` followed a pipeline whose exit status was `sed`'s, and `sed` exits 0 on empty input.

<!--
plan: docs/plans/2026-09-24-adoption-notices-a-stale-default-branch.md
bumps:
  skills:
    plot: patch
-->
