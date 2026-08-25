---
"@plot-pm/skills": minor
---

A worker now loops to take the next wave of its plan.

After completing its branch, a worker calls `plot-fleet-scan.sh --next "$PLOT_SLUG"` to ask for another claimable branch of the same plan. If one exists, it claims it via the standard ref-push mechanism, creates a worktree, and continues implementing — reusing the session that built the first wave rather than exiting and waiting for dispatch to start a new one.

When `--next` finds nothing to start (exit 1), the loop exits cleanly. A hopping worker takes no new slot against the cap, which is the property that makes continued work free.

Implementation notes:
- `plot-dispatch.sh` now exports `PLOT_SLUG` so the worker knows which plan to query
- The Worker command now calls `plot-worker-loop.sh`, a helper script that implements the claim-hop loop
- The actual `claude -p` invocation lives in `.plot/worker-prompt.sh`, sourced by the loop script — this avoids the `plot-config.sh` parser stripping `$(...)` as parenthetical prose

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
