---
'plot': minor
---

`plot-ask.mjs release-approve <pr> <sha>` approves and merges the changesets release PR in one action. It refuses `head-moved`, `review-missing`, `not-release-pr` and `unattended`. After the merge it waits up to `Checks wait` for the version tag, then books every scope plan as Released (docs and infra included) and closes the sprint in one commit and one push; a second run reports `already-released` and writes nothing. `plot-ask.mjs merge` refuses the release PR with `release-pr`.

<!--
plan: docs/plans/2026-10-29-the-release-waits-for-one-approval.md
bumps:
  skills:
    plot: minor
-->
