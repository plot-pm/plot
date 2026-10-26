---
"plot": patch
---

Fixed `plot-reconcile-scan.sh` section 23 asking `issue-view` once per plan·key pair instead of once per distinct key across the sweep, so a key two finished plans name (directly and via a duplicate `ticket:` fallback) was re-asked of the host (#2479). Also corrected four stale comments describing behaviour section 23 no longer has, including removing a note about `issue-list`'s assignee-scoped JQL that does not apply to this section's `issue-view` lookups at all. Section 24b's repair hint now distinguishes a wave whose heading never carried a readable `Branch:` from a wave whose heading already claims a different branch, and `skills/plot-reconcile/SKILL.md` documents `unread_heading_items`/section 24b and corrects its stale "windowed list" description of section 23.

<!--
plan: docs/plans/active/reconcile-scan-sections-7-20-24.md
bumps:
  skills:
    plot: patch
-->
