---
'@plot-pm/board': patch
---

The release finish no longer refuses `release-scope-mismatch`. Where no sprint names the version, it books the Delivered plans the release's changesets name, closes no sprint, and names each open sprint that names another version in its notes as `open sprint <slug> names <version>; left open`. Where no sprint names the version and the changesets cannot be read, it refuses `shipped-unread` rather than answering `already-released`.

<!--
plan: docs/plans/2026-11-27-a-release-between-two-sprints-books-its-plans.md
bumps:
  skills:
    plot-release: patch
-->
