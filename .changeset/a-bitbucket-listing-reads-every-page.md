---
'plot': patch
---

`bb_state_listing` now follows Bitbucket's `next` through `_bb_paged_walk`'s row-limit mode until it holds `--limit` rows or a page's own envelope names no further page, so a merged PR older than the newest 50 is no longer read as having no PR. Truncation and completeness reporting read the same envelope signal for every page of the walk, not just a single call. `pr-refresh.ts` now backs off a Bitbucket full read's own merged-PR listing to 50 rows instead of 500, keeping the paged walk inside the existing 3-request-per-refresh budget, and skips `prReview` for a PR merged before `since`. This slice supersedes #2400 (`plot-host-bitbucket-pr-list-reads`), already Delivered on main with no code.

<!--
plan: docs/plans/2026-10-23-read-merged-prs-from-the-merge.md
bumps:
  skills: {}
-->
