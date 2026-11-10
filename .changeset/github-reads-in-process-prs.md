---
'plot': patch
---

The domain package gains `githubPrListing`, an in-process GitHub PR listing that sends the GraphQL requests `gh pr list` sends and answers `Host.prListing` with the rows, completeness words and refusals `plot-host.sh pr-list` gives. A walk refused mid-way keeps the rows it read and is never whole. Nothing calls it yet. Two corpus tests hold it to `plot-host.sh`: one over recorded GitHub answers, one over the `CHECKS_OF` and `MERGEABLE_OF` jq programs.

<!--
plan: docs/plans/2026-11-09-github-reads-in-process.md
-->
