---
'plot': patch
---

`plot-review-status.sh` no longer exits 1 on a sprint line with no `[slug]`: the slug-extraction pipeline tolerates a non-match under `set -euo pipefail`, the same guard the annotation pipeline beside it already carries.

<!--
plan: docs/plans/2026-10-21-plot-review-status-sh-exits-1.md
bumps:
  skills:
    plot: patch
-->
