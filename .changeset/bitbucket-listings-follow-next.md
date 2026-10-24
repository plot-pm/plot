---
'plot': patch
---

Fixed `plot-host.sh` reading only the first page of a Bitbucket branch's pull requests (#2484): `bb_branch_query` and `pr-review`'s statuses/comments reads each stopped at the endpoint's 50-row ceiling, so a branch with more than 50 matching pull requests, or a `review-bypass:` comment recorded past the first page, went unseen. Both now follow the response's `next` link until the host stops offering one or a 20-page cap is reached, and a walk the cap stops reports `possibly truncated` on stderr and exits non-zero rather than silently returning a partial answer.

<!--
plan: docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md
bumps:
  skills:
    plot: patch
-->
