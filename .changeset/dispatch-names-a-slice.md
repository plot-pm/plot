---
'plot': minor
---

The dispatch controller starts a named slice: `plot-dispatch-command.mjs <slug> --branch <branch>`, and an optional `branch` in the body of `POST /api/dispatch` and `POST /api/implement`, brief that branch and hand it to `plot-dispatch.sh --branch <branch>`. The domain rule `dispatchReadingFor` decides from the pulse, and a branch the pulse does not show as startable for the plan is refused as `no-pulse-reading`, `branch-not-in-plan` or `branch-not-startable` with the reason. Without a branch, the first startable branch is briefed as before.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
