---
'plot': minor
---

The `Tracker` port gains `versionRead`, a read of one Jira version and the issues whose `fixVersion` names it. `tracker-jira.ts` reads the version list of every `Ticket prefixes` project through a new `plot-host.sh version-list` op, and the issues through `issue-list --fix-version`, a `fixVersion` JQL search scoped to the same projects; `trackerNone`, `trackerGithub` and `trackerGitHost` answer `unaskable`, since none of those three names a version or a `fixVersion`.

<!--
plan: docs/plans/2026-10-21-a-sprint-cannot-be-read-as.md
-->
