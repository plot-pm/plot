---
'plot': minor
---

`plot-ask.mjs release-approve <pr> <sha>` approves and merges the changesets release PR in one action. It refuses `head-moved`, `review-missing`, `not-release-pr`, `unaskable` and `unattended`. After the merge it reads the version from the freshly fetched default branch, refusing `default-branch-unfetched` when that fetch fails, and waits up to `Checks wait` for the version tag. It then books every scope plan as Released (docs and infra included), closes the sprint through the sprint transition and removes its active index entry in one commit and one push; an active index holding more than one sprint refuses `sprint-ambiguous`, and a second run reports `already-released` and writes nothing. `plot-ask.mjs merge` refuses the release PR with `release-pr`.

<!--
plan: docs/plans/2026-10-29-the-release-waits-for-one-approval.md
bumps:
  skills:
    plot: minor
-->
