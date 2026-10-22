---
'plot': patch
---

`plot-reconcile`'s section 20 now lists a ref as merged when section 3 already proved it, on a cut Bitbucket merged-PR list — section 3's per-branch answer is folded into `merged_pr_heads` instead of being discarded, so section 20 reads the same evidence at no extra host cost. Both truncation notes (sections 2 and 20) now name the actual Bitbucket page size (50) rather than the requested `MERGED_PR_LIMIT` (500); GitHub's note is unchanged, since its `--limit` is an honoured ceiling.

<!--
plan: docs/plans/2026-10-22-reconcile-20-ignores-merges-3-proved.md
bumps:
  skills:
    plot-reconcile: patch
-->
