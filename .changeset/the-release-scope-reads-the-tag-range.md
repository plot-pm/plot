---
'plot': minor
---

The release finish and the Delivery tab's unbooked row now also book every Delivered plan whose slices first shipped in the release tag. The reading uses local git only: each slice's `→ #N` PR is matched to a merge subject on the default branch or an `origin/sprint/*` branch, and a `→ commit` slice to its commit. The finish's first note names every booked plan with its source (`sprint`, `changeset` or `tag`), a second note names each plan the tag touched and left with its reason (`slice-after-tag`, `no-merge-subject`, `slice-foreign`, `not-delivered` or `already-released`), and `range-unread` names a tag reading that failed.

<!--
plan: docs/plans/2026-11-27-a-release-between-two-sprints-books-its-plans.md
bumps:
  skills:
    plot-release: minor
-->
