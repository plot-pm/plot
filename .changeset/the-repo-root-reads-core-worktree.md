---
'plot': patch
---

`plot_repo_root` answers a submodule's working tree: where the common git dir is not `.git`, it reads `core.worktree`, so `plot-fleetctl.sh --status` in a submodule checkout no longer exits 3 with "not part of the estate" (#3043). The agent settings path, the board artifact path, `plot-host.sh`'s fallback `.env` and the worker-state registry root ask the same rule.

<!--
plan: docs/plans/2026-11-23-fleetctl-runs-in-a-submodule-checkout.md
bumps:
  skills:
    plot: patch
-->
