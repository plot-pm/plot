---
'plot': patch
---

CI fails a changeset that names a package outside the workspace.

An unknown package makes `changeset version` abort the entire release rather
than skip the file, so one bad name freezes every subsequent release PR. On
2026-08-26 six changesets named `@plot-pm/plot`, `@plot-pm/skills` and
`plot-deliver`; the v2.9.0 release PR sat at 8 of 98 changesets for four days,
355 commits behind main, and nothing reported the cause.

The valid names are derived from the workspace's own package.json files, so
adding a package cannot leave the check stale.
