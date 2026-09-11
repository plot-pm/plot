---
'plot': patch
---

The reconcile scan names a merge that shipped code and added no changeset. Section 20 is advisory, carries its own `no_changeset=` footer key, and reads the merge commit's two parents rather than a branch ref that delivery has already deleted — so it needs no git-host call. Both questions are asked from the merge base, because diffing the two tips attributes main's own commits to the branch.

<!--
plan: docs/plans/2026-09-11-a-merge-without-a-changeset-is-named.md
bumps:
  skills:
    plot: patch
-->
