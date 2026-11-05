---
'plot': patch
---

`release-approve` refuses a release head that changes more than the changesets version step writes, and the release review start holds on it. The rule reads `origin/main...<pinned sha>` at line level through the new `Refs.headChanges` and allows changeset deletions, changelogs, the `version` line of the package and plugin manifests, and each skill's `metadata.version`. Any other change refuses `release-head-foreign` naming the first foreign path; the board's release row shows the stage `release-head-foreign`. An empty or unreadable diff refuses `unaskable`. GitHub only.

<!--
plan: docs/plans/2026-11-03-the-release-pr-needs-a-person.md
bumps:
  skills:
    plot-release: patch
-->
