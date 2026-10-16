---
'plot': patch
---

`plot-push-main.sh`'s lifecycle pushes to a GitHub default branch and `plot-host.sh pr-merge`'s GitHub merges now authenticate as two new GitHub App identities (Writer, Merger) instead of the signed-in `gh` account, closing the gap where a bypass-capable maintainer identity merged PRs with no required checks run. Both Apps share one JWT-to-installation-token exchange, extracted from `plot-commit-status.mjs`'s existing one; an absent or unreadable key refuses by name (exit 4) with no fallback, and a configuration naming the same App id for both keys is refused.

<!--
plan: docs/plans/2026-10-15-a-lifecycle-micro-pr-merged-past.md
bumps:
  skills:
    plot: patch
-->
