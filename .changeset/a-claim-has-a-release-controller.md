---
'@plot-pm/board': patch
---

`POST /api/release-claim {branch}` and `plot-ask.mjs release-claim <branch>` both reach `releaseClaim` in `@plot-pm/domain`, the controller `plot-dispatch.sh --release` had none of (#1276). The domain decides `agent-live` (read from the manifests' own desk, not merely a ref) and `pr-open` (an open or merged PR, or a host reading that cannot be answered); the adapter still runs `plot-dispatch.sh --release` for the mechanics and the four refusals that stay the shell's to enforce. A script refusal becomes a 409 carrying its own sentence rather than a silent success.

<!--
plan: docs/plans/2026-10-07-a-controller-owns-what-it-starts.md
bumps:
  skills:
    plot: patch
-->
