---
'plot': patch
---

A contract test that builds a temp repository scrubs `PLOT_REPO_ROOT` from the environment it hands to a Plot script, so the sandbox's own `## Plot Config` is read rather than the host's. `plot-config.sh` prefers an exported `PLOT_REPO_ROOT` over `git rev-parse`, and that variable travels by plain inheritance from the launchd supervisor through the dispatcher, the wrapper and the worker loop into any suite a dispatched worker runs — so the sandbox read this estate's absolute `Agent registry` and wrote its agent manifest into the host's `.plot/agents/`. Measured 2026-09-25: 19 of 20 manifests there were test fixtures, against three real desks, and the board rendered each one as an agent row. The scrub sits at the three places an environment is built, and a post-suite gate refuses a manifest whose recorded `worktree` lies under a system temp root — the discriminator that tolerates a live agent writing mid-run, which `the registry is unchanged` cannot.

<!--
plan: docs/plans/2026-09-26-a-sandbox-does-not-inherit-its-host.md
-->
