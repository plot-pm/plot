---
'plot': patch
---

`plot-review.mjs` writes `plot/review success` on a new head without a reviewer run when an earlier review of the same PR passed with no HIGH finding and read the same diff. A merge of the base branch that leaves the PR's change as it was, conflict resolution included, no longer waits for a second full review. Two diffs are the same when they differ only in `index` lines and hunk line numbers, and the status names the head it carries from (#3549).
