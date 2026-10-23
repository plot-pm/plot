---
'@plot-pm/board': patch
---

Fix a plan appearing twice on the board after its plan PR merges. `collectBranchPlans`'s cache keyed only on the prefixed branches' tip SHAs, so a merge that added a plan file to the default branch — without moving the idea branch's own tip — left the key unchanged and the cache kept serving the pre-merge list. The cache key now also carries the default branch's tip, an ancestry prefilter drops a branch whose tip is a true ancestor of the default branch before reading its tree, and a final path-based de-duplication guard in `buildBoard` ensures the default branch's reading always wins over a stale branch-cache entry.

<!--
plan: docs/plans/2026-10-23-plans-shown-twice-after-a-plan.md
-->
