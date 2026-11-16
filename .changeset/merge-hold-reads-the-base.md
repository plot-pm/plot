---
'plot': patch
---

`plot-ask.mjs merge` applies the default-branch holds (`default-branch-red` with its repair admission, `default-branch-stale`, `default-branch-unsettled`, `default-branch-unread`) only to a PR whose base is the default branch. A PR into another branch, such as a sprint integration branch, merges whatever the default branch reads, and every other refusal still applies to it.
