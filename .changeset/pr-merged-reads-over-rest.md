---
'plot': patch
---

On GitHub, `plot-host.sh` answers `pr-merged`, `pr-merge-commit`, `pr-merge-dest` and `pr-merged-heads` from the REST `pulls?head=<owner>:<branch>&state=all` endpoint, in the `core` bucket, and no longer from `gh pr list`, which spends the `graphql` bucket. The answers still read `merged_at` and never a PR's state, and a failed or rate-limited read still answers `unknown` or exits 3. On 2026-11-19 `pr-merged` was the GraphQL call that spent 5,246 of 5,000 GraphQL points in 60 minutes.

<!--
bumps:
  skills:
    plot: patch
-->
